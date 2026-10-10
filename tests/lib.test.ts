import { describe, expect, it } from 'vitest';
import {
  AirQualityError, buildAirQualityUrl, buildBatchUrl, fetchAirQuality, fetchAirQualityBatch, parseAirQuality, parseBatch,
} from '../src/lib/aq';
import {
  ACTIVITIES, UG_PER_CIGARETTE, activityForPace, activityForSpeed, cigaretteEquivalent, cigarettesPerDayAtRest,
  getActivity, hrMax, inhaledDoseUg, retainedDoseUg, sittingHoursEquivalent, zoneBpm,
} from '../src/lib/dose';
import { formatAge, formatDuration, formatHoursEquivalent, formatLocalTime } from '../src/lib/format';
import { categoryForAqi, mainPollutant, severityForAqi } from '../src/lib/health';
import { DEFAULT_PLAN, PLAN_STORAGE_KEY, loadPlan, sanitizePlan, savePlan } from '../src/lib/plan';
import { bestWindow, maxAdvisedZone, recommend } from '../src/lib/recommend';
import { DEFAULT_SPOT_ID, SPOTS, getSpot, spotStates } from '../src/lib/spots';

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
const HOUR = 3_600_000;

describe('dose and zones', () => {
  it('computes inhaled dose = concentration x air breathed', () => {
    expect(inhaledDoseUg(50, 60, 10)).toBeCloseTo(30, 6); // 50 ug/m3 x 0.06 m3/min x 10 min
  });
  it('breathes far more air at higher effort in the same air', () => {
    const rest = inhaledDoseUg(40, getActivity('rest').litresPerMinute, 30);
    const z5 = inhaledDoseUg(40, getActivity('z5').litresPerMinute, 30);
    expect(z5 / rest).toBeCloseTo(120 / 7, 6);
  });
  it('returns 0 for invalid input', () => {
    expect(inhaledDoseUg(NaN, 60, 10)).toBe(0);
    expect(inhaledDoseUg(-5, 60, 10)).toBe(0);
    expect(inhaledDoseUg(10, 60, -1)).toBe(0);
    expect(retainedDoseUg(NaN, getActivity('z3'))).toBe(0);
    expect(cigaretteEquivalent(-1)).toBe(0);
  });
  it('retains a larger share as effort rises (assumed values)', () => {
    const shares = ACTIVITIES.map((a) => a.retained);
    expect([...shares].sort((a, b) => a - b)).toEqual(shares);
    expect(retainedDoseUg(100, getActivity('z4'))).toBeCloseTo(40, 9);
  });
  it('defines one cigarette as 22 ug/m3 for 24 h at resting ventilation (7 L/min)', () => {
    expect(UG_PER_CIGARETTE).toBeCloseTo(221.76, 2);
    expect(cigaretteEquivalent(UG_PER_CIGARETTE)).toBeCloseTo(1, 9);
    expect(cigarettesPerDayAtRest(44)).toBeCloseTo(2, 9);
  });
  it('sitting-hours equivalent is 1 h for one hour at rest and grows with effort', () => {
    expect(sittingHoursEquivalent(getActivity('rest'), 60)).toBeCloseTo(1, 9);
    // Z2: 40 L/min x 30% vs 7 L/min x 20% = ~8.57x
    expect(sittingHoursEquivalent(getActivity('z2'), 60)).toBeCloseTo((40 * 0.3) / (7 * 0.2), 9);
    expect(sittingHoursEquivalent(getActivity('z2'), 0)).toBe(0);
  });
  it('computes heart rate zones from age (Tanaka)', () => {
    expect(hrMax(30)).toBe(187);
    expect(zoneBpm(getActivity('z2'), 30)).toEqual([112, 131]);
    expect(zoneBpm(getActivity('rest'), 30)).toBeNull();
  });
  it('maps speed and pace to a breathing level', () => {
    expect(activityForSpeed(0.5)).toBe('rest');
    expect(activityForSpeed(3)).toBe('walk');
    expect(activityForSpeed(5)).toBe('z1');
    expect(activityForSpeed(8)).toBe('z2');
    expect(activityForSpeed(10)).toBe('z3');
    expect(activityForSpeed(12)).toBe('z4');
    expect(activityForSpeed(15)).toBe('z5');
    expect(activityForPace(6.5)).toBe('z3'); // 9.2 km/h
    expect(activityForPace(NaN)).toBe('z2');
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
  const z = (id: Parameters<typeof getActivity>[0]) => getActivity(id);

  it('follows the AQI table for the maximum advised zone', () => {
    expect(maxAdvisedZone(40, false)).toBe(5);
    expect(maxAdvisedZone(80, true)).toBe(3);
    expect(maxAdvisedZone(120, false)).toBe(2);
    expect(maxAdvisedZone(120, true)).toBe(1);
    expect(maxAdvisedZone(160, false)).toBe(1);
    expect(maxAdvisedZone(160, true)).toBe(0);
    expect(maxAdvisedZone(250, false)).toBe(0);
  });
  it('goes in clean air at any zone', () => {
    const r = recommend({ pm25: 8, usAqi: 35, activity: z('z5'), sensitive: false });
    expect(r.verdict).toBe('go');
    expect(r.title).toBe('Good for your run');
  });
  it('eases off when the planned zone exceeds the advised zone', () => {
    const r = recommend({ pm25: 10, usAqi: 160, activity: z('z3'), sensitive: false });
    expect(r.verdict).toBe('caution');
    expect(r.title).toBe('Ease off to Zone 1');
  });
  it('says treadmill day when the AQI table allows no outdoor running', () => {
    const r = recommend({ pm25: 10, usAqi: 160, activity: z('z2'), sensitive: true });
    expect(r.verdict).toBe('avoid');
    expect(r.title).toBe('Treadmill day');
  });
  it('is stricter for a sensitive profile', () => {
    const base = { pm25: 10, usAqi: 120, activity: z('z2') };
    expect(recommend({ ...base, sensitive: false }).verdict).toBe('go');
    expect(recommend({ ...base, sensitive: true }).verdict).toBe('caution');
  });
  it('takes the stricter of the AQI check and the PM2.5 check', () => {
    expect(recommend({ pm25: 22, usAqi: 40, activity: z('z2'), sensitive: false }).verdict).toBe('caution');
    expect(recommend({ pm25: 40, usAqi: 40, activity: z('z2'), sensitive: false }).verdict).toBe('avoid');
    const both = recommend({ pm25: 22, usAqi: 160, activity: z('z3'), sensitive: false });
    expect(both.verdict).toBe('caution');
    expect(both.reasons).toHaveLength(2);
  });
  it('uses a gentler scale for walking and ignores hourly PM2.5', () => {
    expect(recommend({ pm25: 60, usAqi: 120, activity: z('walk'), sensitive: false }).verdict).toBe('go');
    expect(recommend({ pm25: 10, usAqi: 120, activity: z('walk'), sensitive: true }).verdict).toBe('caution');
    expect(recommend({ pm25: 10, usAqi: 180, activity: z('walk'), sensitive: false }).title).toBe('Short walk only');
    expect(recommend({ pm25: 10, usAqi: 250, activity: z('rest'), sensitive: false }).verdict).toBe('avoid');
  });

  describe('bestWindow', () => {
    const OFFSET = 28800; // UTC+8
    const at = (localIso: string) => Date.parse(`${localIso}Z`) - OFFSET * 1000;
    it('finds a meaningfully cleaner hour within 12 h', () => {
      const forecast = [
        { epoch: at('2026-10-10T16:00'), pm25: 22 },
        { epoch: at('2026-10-10T19:00'), pm25: 12 },
      ];
      expect(bestWindow(forecast, 22, at('2026-10-10T16:30'), OFFSET)?.pm25).toBe(12);
    });
    it('ignores hours outside 05:00-21:00 local', () => {
      const forecast = [{ epoch: at('2026-10-10T23:00'), pm25: 3 }];
      expect(bestWindow(forecast, 22, at('2026-10-10T16:30'), OFFSET)).toBeNull();
    });
    it('ignores hours beyond the 12 h horizon', () => {
      const forecast = [{ epoch: at('2026-10-11T06:00'), pm25: 3 }];
      expect(bestWindow(forecast, 22, at('2026-10-10T16:30'), OFFSET)).toBeNull();
    });
    it('returns null when waiting would not help or there is no forecast', () => {
      const forecast = [{ epoch: at('2026-10-10T19:00'), pm25: 20 }];
      expect(bestWindow(forecast, 22, at('2026-10-10T16:30'), OFFSET)).toBeNull();
      expect(bestWindow([], 22, NOW, OFFSET)).toBeNull();
    });
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
    try {
      parseAirQuality(payload(), NOW + 4 * HOUR);
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

describe('batch requests', () => {
  it('builds one URL for many locations and rejects invalid coordinates', () => {
    const url = buildBatchUrl([{ lat: 3.1546, lon: 101.7145 }, { lat: 5.438, lon: 100.31 }]);
    expect(url).toContain('latitude=3.1546%2C5.4380');
    expect(url).toContain('longitude=101.7145%2C100.3100');
    expect(buildAirQualityUrl(3.139, 101.6869)).toContain('latitude=3.1390');
    expect(() => buildBatchUrl([])).toThrow(AirQualityError);
    expect(() => buildBatchUrl([{ lat: NaN, lon: 0 }])).toThrow(AirQualityError);
    expect(() => buildBatchUrl([{ lat: 95, lon: 0 }])).toThrow(AirQualityError);
  });
  it('parses an array and keeps a failing entry from hiding the others', () => {
    const results = parseBatch([payload(), payload({ pm2_5: null }), payload()], 3, NOW);
    expect(results).toHaveLength(3);
    expect(results[0]).not.toBeInstanceOf(AirQualityError);
    expect(results[1]).toBeInstanceOf(AirQualityError);
    expect(results[2]).not.toBeInstanceOf(AirQualityError);
  });
  it('accepts a single object for a single location', () => {
    expect(parseBatch(payload(), 1, NOW)).toHaveLength(1);
  });
  it('rejects a response that does not match the request', () => {
    expect(() => parseBatch([payload()], 2, NOW)).toThrow(AirQualityError);
  });
  it('requests all spots in a single fetch', async () => {
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      return new Response(JSON.stringify(SPOTS.map(() => payload())), { status: 200 });
    }) as unknown as typeof fetch;
    const results = await fetchAirQualityBatch(SPOTS.map((s) => ({ lat: s.lat, lon: s.lon })), { fetchImpl: fake, now: NOW });
    expect(calls).toBe(1);
    expect(results).toHaveLength(SPOTS.length);
  });
  it('maps network failure and non-OK responses to clear errors', async () => {
    const failing = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(fetchAirQuality(3, 101, { fetchImpl: failing, now: NOW })).rejects.toMatchObject({ reason: 'network' });
    const bad = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchAirQuality(3, 101, { fetchImpl: bad, now: NOW })).rejects.toMatchObject({ reason: 'network' });
  });
  it('returns parsed data for a single location and throws if that reading is unusable', async () => {
    const ok = (async () => new Response(JSON.stringify(payload()), { status: 200 })) as unknown as typeof fetch;
    expect((await fetchAirQuality(3, 101, { fetchImpl: ok, now: NOW })).pm25).toBe(22.1);
    const missing = (async () => new Response(JSON.stringify(payload({ pm2_5: null })), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchAirQuality(3, 101, { fetchImpl: missing, now: NOW })).rejects.toBeInstanceOf(AirQualityError);
  });
});

describe('plan', () => {
  it('falls back to defaults for garbage and clamps out-of-range values', () => {
    expect(sanitizePlan(null)).toEqual(DEFAULT_PLAN);
    expect(sanitizePlan('x')).toEqual(DEFAULT_PLAN);
    expect(sanitizePlan({ activity: 'z9', minutes: 'a', age: {}, sensitive: 'yes' })).toEqual(DEFAULT_PLAN);
    expect(sanitizePlan({ activity: 'z4', minutes: 9999, age: 5, sensitive: true })).toEqual({
      activity: 'z4', minutes: 180, age: 10, sensitive: true,
    });
    expect(sanitizePlan({ minutes: 47.6 }).minutes).toBe(48);
  });
  it('saves and loads from storage, and survives corrupt or missing storage', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    savePlan({ activity: 'z3', minutes: 60, age: 40, sensitive: true }, storage);
    expect(loadPlan(storage)).toEqual({ activity: 'z3', minutes: 60, age: 40, sensitive: true });
    data.set(PLAN_STORAGE_KEY, '{not json');
    expect(loadPlan(storage)).toEqual(DEFAULT_PLAN);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadPlan(throwing)).toEqual(DEFAULT_PLAN);
    expect(() => savePlan(DEFAULT_PLAN, throwing)).not.toThrow();
  });
});

describe('spots data', () => {
  it('has unique ids and valid Malaysian coordinates', () => {
    expect(new Set(SPOTS.map((s) => s.id)).size).toBe(SPOTS.length);
    for (const s of SPOTS) {
      expect(s.lat).toBeGreaterThan(0.8);
      expect(s.lat).toBeLessThan(7.5);
      expect(s.lon).toBeGreaterThan(99);
      expect(s.lon).toBeLessThan(120);
      expect(s.distanceKm).toBeGreaterThan(0);
    }
  });
  it('only marks a distance as sourced when sources are given', () => {
    for (const s of SPOTS) {
      if (s.basis === 'sourced') expect(s.sources?.length ?? 0).toBeGreaterThan(0);
      else expect(s.sources).toBeUndefined();
    }
  });
  it('has the default spot and a state list', () => {
    expect(getSpot(DEFAULT_SPOT_ID)?.name).toContain('KLCC');
    expect(spotStates()).toContain('Penang');
    expect(getSpot('nope')).toBeUndefined();
  });
});

describe('format', () => {
  it('formats duration, local time, age and hours', () => {
    expect(formatDuration(8.45)).toBe('8 min 27 s');
    expect(formatDuration(75)).toBe('1 h 15 min');
    expect(formatLocalTime(Date.parse('2026-10-10T08:00:00Z'), 28800)).toBe('16:00 (UTC+8)');
    expect(formatAge(NOW - 90 * 60_000, NOW)).toBe('1 h 30 min ago');
    expect(formatHoursEquivalent(0.5)).toBe('30 min');
    expect(formatHoursEquivalent(2.54)).toBe('2.5 h');
    expect(formatHoursEquivalent(14.2)).toBe('14 h');
  });
});
