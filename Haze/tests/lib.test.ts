import { describe, expect, it } from 'vitest';
import { AirQualityError, buildAirQualityUrl, fetchAirQuality, parseAirQuality } from '../src/lib/aq';
import {
  UG_PER_CIGARETTE, activityForPace, cigaretteEquivalent, cigarettesPerDayAtRest, getActivity, inhaledDoseUg,
} from '../src/lib/dose';
import { formatAge, formatDuration, formatLocalTime, formatPace } from '../src/lib/format';
import { categoryForAqi, mainPollutant, severityForAqi } from '../src/lib/health';
import { bestWindow, recommend } from '../src/lib/recommend';

// Shape taken from a real Open-Meteo response (values trimmed).
function payload(overrides: Record<string, unknown> = {}, time = '2026-10-10T16:00') {
  return {
    latitude: 3.1, longitude: 101.7, utc_offset_seconds: 28800,
    current: {
      time, interval: 3600, pm2_5: 22.1, pm10: 22.7, nitrogen_dioxide: 20.7, ozone: 127, sulphur_dioxide: 19.8,
      carbon_monoxide: 544, us_aqi: 160, us_aqi_pm2_5: 160, us_aqi_pm10: 57, us_aqi_nitrogen_dioxide: 10,
      us_aqi_ozone: 58, us_aqi_sulphur_dioxide: 11, us_aqi_carbon_monoxide: 12, ...overrides,
    },
    hourly: { time: ['2026-10-10T16:00', '2026-10-10T17:00'], pm2_5: [22.1, 12] },
  };
}
// 16:00 local (UTC+8) = 08:00 UTC
const NOW = Date.parse('2026-10-10T08:30:00Z');

describe('dose', () => {
  it('computes inhaled dose = concentration x ventilation x time', () => {
    // 50 ug/m3 x 0.06 m3/min x 10 min = 30 ug
    expect(inhaledDoseUg(50, 60, 10)).toBeCloseTo(30, 6);
  });
  it('is higher with more effort in the same air', () => {
    const rest = inhaledDoseUg(40, getActivity('rest').litresPerMinute, 30);
    const run = inhaledDoseUg(40, getActivity('run').litresPerMinute, 30);
    expect(run / rest).toBeCloseTo(8, 6);
  });
  it('returns 0 for invalid input', () => {
    expect(inhaledDoseUg(NaN, 60, 10)).toBe(0);
    expect(inhaledDoseUg(-5, 60, 10)).toBe(0);
    expect(inhaledDoseUg(10, 60, -1)).toBe(0);
  });
  it('defines one cigarette as 22 ug/m3 for 24 h at resting ventilation', () => {
    expect(UG_PER_CIGARETTE).toBeCloseTo(237.6, 1);
    expect(cigaretteEquivalent(UG_PER_CIGARETTE)).toBeCloseTo(1, 9);
    expect(cigarettesPerDayAtRest(44)).toBeCloseTo(2, 9);
  });
  it('maps pace to a breathing level', () => {
    expect(activityForPace(5)).toBe('run');
    expect(activityForPace(7)).toBe('jog');
    expect(activityForPace(10)).toBe('walk');
    expect(activityForPace(NaN)).toBe('jog');
  });
});

describe('health', () => {
  it('categorises US AQI at the boundaries', () => {
    expect(categoryForAqi(50).id).toBe('good');
    expect(categoryForAqi(51).id).toBe('moderate');
    expect(categoryForAqi(150).id).toBe('sensitive');
    expect(categoryForAqi(160).id).toBe('unhealthy');
    expect(categoryForAqi(301).id).toBe('hazardous');
    expect(categoryForAqi(2000).id).toBe('hazardous');
  });
  it('clamps severity to 0..1', () => {
    expect(severityForAqi(-10)).toBe(0);
    expect(severityForAqi(150)).toBeCloseTo(0.5, 6);
    expect(severityForAqi(900)).toBe(1);
  });
  it('picks the highest sub-index as main pollutant, ignoring nulls', () => {
    expect(mainPollutant({ pm2_5: 160, pm10: 57, ozone: 58 })).toBe('pm2_5');
    expect(mainPollutant({ pm2_5: null, ozone: 58 })).toBe('ozone');
    expect(mainPollutant({})).toBeNull();
  });
});

describe('recommend', () => {
  it('goes when PM2.5 is within the WHO guideline and AQI is low', () => {
    expect(recommend(10, 40).verdict).toBe('go');
  });
  it('cautions between 15 and 35', () => {
    expect(recommend(22, 80).verdict).toBe('caution');
  });
  it('avoids above 35', () => {
    expect(recommend(36, 80).verdict).toBe('avoid');
  });
  it('raises one level when the 24 h AQI is 151+', () => {
    expect(recommend(10, 160).verdict).toBe('caution');
    expect(recommend(22, 160).verdict).toBe('avoid');
  });
  it('finds a cleaner window only if it is meaningfully cleaner', () => {
    const forecast = [
      { epoch: NOW, pm25: 22 },
      { epoch: NOW + 3_600_000, pm25: 12 },
    ];
    expect(bestWindow(forecast, 22, NOW)?.pm25).toBe(12);
    expect(bestWindow(forecast, 14, NOW)).toBeNull();
    expect(bestWindow([], 22, NOW)).toBeNull();
  });
});

describe('parseAirQuality', () => {
  it('parses a valid response and converts local time to UTC', () => {
    const aq = parseAirQuality(payload(), NOW);
    expect(aq.pm25).toBe(22.1);
    expect(aq.usAqi).toBe(160);
    expect(aq.observedAt).toBe(Date.parse('2026-10-10T08:00:00Z'));
    expect(aq.forecast).toHaveLength(2);
    expect(aq.concentrations.pm10).toBe(22.7);
  });
  it('rejects a missing PM2.5 value instead of inventing one', () => {
    expect(() => parseAirQuality(payload({ pm2_5: null }), NOW)).toThrow(AirQualityError);
  });
  it('rejects a missing AQI', () => {
    expect(() => parseAirQuality(payload({ us_aqi: undefined }), NOW)).toThrow(AirQualityError);
  });
  it('rejects stale data older than 3 hours', () => {
    const later = NOW + 4 * 3_600_000;
    try {
      parseAirQuality(payload(), later);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AirQualityError);
      expect((error as AirQualityError).reason).toBe('stale');
    }
  });
  it('rejects error bodies and garbage', () => {
    expect(() => parseAirQuality({ error: true, reason: 'x' }, NOW)).toThrow(AirQualityError);
    expect(() => parseAirQuality('nope', NOW)).toThrow(AirQualityError);
    expect(() => parseAirQuality({ current: {} }, NOW)).toThrow(AirQualityError);
  });
});

describe('fetchAirQuality', () => {
  it('builds a safe URL and rejects invalid coordinates', () => {
    const url = buildAirQualityUrl(3.139, 101.6869);
    expect(url).toContain('latitude=3.1390');
    expect(url).toContain('longitude=101.6869');
    expect(() => buildAirQualityUrl(NaN, 0)).toThrow(AirQualityError);
    expect(() => buildAirQualityUrl(95, 0)).toThrow(AirQualityError);
  });
  it('maps network failure to a clear error', async () => {
    const failing = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(fetchAirQuality(3, 101, { fetchImpl: failing, now: NOW })).rejects.toMatchObject({ reason: 'network' });
  });
  it('maps non-OK responses to a network error', async () => {
    const bad = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchAirQuality(3, 101, { fetchImpl: bad, now: NOW })).rejects.toMatchObject({ reason: 'network' });
  });
  it('returns parsed data on success', async () => {
    const ok = (async () => new Response(JSON.stringify(payload()), { status: 200 })) as unknown as typeof fetch;
    const aq = await fetchAirQuality(3, 101, { fetchImpl: ok, now: NOW });
    expect(aq.pm25).toBe(22.1);
  });
});

describe('format', () => {
  it('formats pace, duration, local time and age', () => {
    expect(formatPace(6.5)).toBe('6:30 /km');
    expect(formatDuration(8.45)).toBe('8 min 27 s');
    expect(formatDuration(75)).toBe('1 h 15 min');
    expect(formatLocalTime(Date.parse('2026-10-10T08:00:00Z'), 28800)).toBe('16:00 (UTC+8)');
    expect(formatAge(NOW - 90 * 60_000, NOW)).toBe('1 h 30 min ago');
  });
});
