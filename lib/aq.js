/**
 * Open-Meteo air quality client (ported from Haze/src/lib/aq.ts).
 * Data is modelled (CAMS) on a grid, NOT a monitoring-station reading.
 * Docs: https://open-meteo.com/en/docs/air-quality-api  (CC BY 4.0)
 */
const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REQUEST_TIMEOUT_MS = 10_000;
/** Older than this and the value is treated as unavailable rather than shown. */
export const MAX_DATA_AGE_MS = 3 * 60 * 60 * 1000;
const CURRENT_VARS = [
  'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide', 'carbon_monoxide',
  'us_aqi', 'us_aqi_pm2_5', 'us_aqi_pm10', 'us_aqi_nitrogen_dioxide', 'us_aqi_ozone',
  'us_aqi_sulphur_dioxide', 'us_aqi_carbon_monoxide',
];

/** reason: 'network' | 'invalid' | 'stale' */
export class AirQualityError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.name = 'AirQualityError';
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function localTimeToEpoch(localIso, utcOffsetSeconds) {
  const asUtc = Date.parse(`${localIso}Z`);
  return Number.isFinite(asUtc) ? asUtc - utcOffsetSeconds * 1000 : NaN;
}

/** Validate and normalise an Open-Meteo response. Throws AirQualityError instead of returning fake values. */
export function parseAirQuality(json, now = Date.now()) {
  if (!isObject(json) || json['error'] === true) {
    throw new AirQualityError('invalid', 'The air quality service returned an error.');
  }
  const current = json['current'];
  if (!isObject(current)) throw new AirQualityError('invalid', 'The air quality response had no current data.');
  const pm25 = num(current['pm2_5']);
  const usAqi = num(current['us_aqi']);
  const timeText = current['time'];
  if (pm25 === null || usAqi === null || typeof timeText !== 'string') {
    throw new AirQualityError('invalid', 'No air quality reading is available for this location right now.');
  }
  const utcOffsetSeconds = num(json['utc_offset_seconds']) ?? 0;
  const observedAt = localTimeToEpoch(timeText, utcOffsetSeconds);
  if (!Number.isFinite(observedAt)) throw new AirQualityError('invalid', 'The air quality timestamp was not understood.');
  if (now - observedAt > MAX_DATA_AGE_MS) {
    throw new AirQualityError('stale', 'The latest reading is too old to show. Please try again later.');
  }
  const read = (names) => ({
    pm2_5: num(current[names.pm2_5]),
    pm10: num(current[names.pm10]),
    nitrogen_dioxide: num(current[names.nitrogen_dioxide]),
    ozone: num(current[names.ozone]),
    sulphur_dioxide: num(current[names.sulphur_dioxide]),
    carbon_monoxide: num(current[names.carbon_monoxide]),
  });
  const concentrations = read({
    pm2_5: 'pm2_5', pm10: 'pm10', nitrogen_dioxide: 'nitrogen_dioxide',
    ozone: 'ozone', sulphur_dioxide: 'sulphur_dioxide', carbon_monoxide: 'carbon_monoxide',
  });
  const subIndices = read({
    pm2_5: 'us_aqi_pm2_5', pm10: 'us_aqi_pm10', nitrogen_dioxide: 'us_aqi_nitrogen_dioxide',
    ozone: 'us_aqi_ozone', sulphur_dioxide: 'us_aqi_sulphur_dioxide', carbon_monoxide: 'us_aqi_carbon_monoxide',
  });
  const forecast = [];
  const hourly = json['hourly'];
  if (isObject(hourly) && Array.isArray(hourly['time']) && Array.isArray(hourly['pm2_5'])) {
    const times = hourly['time'];
    const values = hourly['pm2_5'];
    times.forEach((t, i) => {
      const value = num(values[i]);
      if (typeof t === 'string' && value !== null) {
        const epoch = localTimeToEpoch(t, utcOffsetSeconds);
        if (Number.isFinite(epoch)) forecast.push({ epoch, pm25: value });
      }
    });
  }
  return {
    pm25, pm10: concentrations.pm10, usAqi, concentrations, subIndices,
    observedAt, utcOffsetSeconds,
    gridLat: num(json['latitude']) ?? NaN,
    gridLon: num(json['longitude']) ?? NaN,
    forecast,
  };
}

export function buildAirQualityUrl(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new AirQualityError('invalid', 'That location is not valid.');
  }
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT_VARS.join(','),
    hourly: 'pm2_5',
    forecast_hours: '24',
    timezone: 'auto',
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export async function fetchAirQuality(lat, lon, options = {}) {
  const url = buildAirQualityUrl(lat, lon);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AirQualityError('network', 'Could not reach the air quality service. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new AirQualityError('network', `The air quality service responded with an error (${response.status}).`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AirQualityError('invalid', 'The air quality response could not be read.');
  }
  return parseAirQuality(body, options.now ?? Date.now());
}
