import type { PollutantKey } from './health';

/**
 * Open-Meteo air quality client.
 * Data is modelled (CAMS) on a grid, NOT a monitoring-station reading. The UI says so.
 * Docs: https://open-meteo.com/en/docs/air-quality-api  (CC BY 4.0, free for non-commercial use)
 */
const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REQUEST_TIMEOUT_MS = 10_000;
/** Older than this and the value is treated as unavailable rather than shown. */
export const MAX_DATA_AGE_MS = 3 * 60 * 60 * 1000;

const CURRENT_VARS = [
  'pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide', 'carbon_monoxide',
  'us_aqi', 'us_aqi_pm2_5', 'us_aqi_pm10', 'us_aqi_nitrogen_dioxide', 'us_aqi_ozone',
  'us_aqi_sulphur_dioxide', 'us_aqi_carbon_monoxide',
] as const;

export type AirQualityErrorReason = 'network' | 'invalid' | 'stale';

export class AirQualityError extends Error {
  constructor(public readonly reason: AirQualityErrorReason, message: string) {
    super(message);
    this.name = 'AirQualityError';
  }
}

export interface HourlyPoint {
  /** Epoch ms of the hour. */
  readonly epoch: number;
  readonly pm25: number;
}

export interface AirQuality {
  readonly pm25: number;
  readonly pm10: number | null;
  readonly usAqi: number;
  readonly concentrations: Record<PollutantKey, number | null>;
  readonly subIndices: Record<PollutantKey, number | null>;
  /** Observation time (epoch ms, UTC) of the modelled value. */
  readonly observedAt: number;
  readonly utcOffsetSeconds: number;
  readonly gridLat: number;
  readonly gridLon: number;
  readonly forecast: readonly HourlyPoint[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function localTimeToEpoch(localIso: string, utcOffsetSeconds: number): number {
  // "2026-10-10T16:00" is local to the location; convert to UTC epoch.
  const asUtc = Date.parse(`${localIso}Z`);
  return Number.isFinite(asUtc) ? asUtc - utcOffsetSeconds * 1000 : NaN;
}

/** Validate and normalise an Open-Meteo response. Throws AirQualityError instead of returning fake values. */
export function parseAirQuality(json: unknown, now: number = Date.now()): AirQuality {
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

  const read = (names: Record<PollutantKey, string>): Record<PollutantKey, number | null> => ({
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

  const forecast: HourlyPoint[] = [];
  const hourly = json['hourly'];
  if (isObject(hourly) && Array.isArray(hourly['time']) && Array.isArray(hourly['pm2_5'])) {
    const times = hourly['time'] as unknown[];
    const values = hourly['pm2_5'] as unknown[];
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

export interface Coord {
  readonly lat: number;
  readonly lon: number;
}

function validCoord({ lat, lon }: Coord): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** One request for several locations. Open-Meteo accepts comma-separated coordinates. */
export function buildBatchUrl(coords: readonly Coord[]): string {
  if (coords.length === 0 || !coords.every(validCoord)) {
    throw new AirQualityError('invalid', 'That location is not valid.');
  }
  const params = new URLSearchParams({
    latitude: coords.map((c) => c.lat.toFixed(4)).join(','),
    longitude: coords.map((c) => c.lon.toFixed(4)).join(','),
    current: CURRENT_VARS.join(','),
    hourly: 'pm2_5',
    forecast_hours: '24',
    timezone: 'auto',
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export function buildAirQualityUrl(lat: number, lon: number): string {
  return buildBatchUrl([{ lat, lon }]);
}

/**
 * Parse a multi-location response. A single location comes back as an object, several as an array.
 * A bad entry becomes an AirQualityError in its slot, so one failing spot never hides the others.
 */
export function parseBatch(json: unknown, count: number, now: number = Date.now()): (AirQuality | AirQualityError)[] {
  const items: unknown[] = Array.isArray(json) ? json : [json];
  if (items.length !== count) {
    throw new AirQualityError('invalid', 'The air quality response did not match the request.');
  }
  return items.map((item) => {
    try {
      return parseAirQuality(item, now);
    } catch (error) {
      if (error instanceof AirQualityError) return error;
      throw error;
    }
  });
}

interface RequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: number;
}

async function requestJson(url: string, options: RequestOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AirQualityError('network', 'Could not reach the air quality service. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new AirQualityError('network', `The air quality service responded with an error (${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new AirQualityError('invalid', 'The air quality response could not be read.');
  }
}

/** Fetch many locations in one request. Throws only if the whole request fails. */
export async function fetchAirQualityBatch(
  coords: readonly Coord[],
  options: RequestOptions = {},
): Promise<(AirQuality | AirQualityError)[]> {
  const body = await requestJson(buildBatchUrl(coords), options);
  return parseBatch(body, coords.length, options.now ?? Date.now());
}

export async function fetchAirQuality(
  lat: number,
  lon: number,
  options: RequestOptions = {},
): Promise<AirQuality> {
  const [result] = await fetchAirQualityBatch([{ lat, lon }], options);
  if (result === undefined || result instanceof AirQualityError) {
    throw result ?? new AirQualityError('invalid', 'No air quality reading is available for this location right now.');
  }
  return result;
}
