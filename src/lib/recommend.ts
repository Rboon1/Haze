import type { HourlyPoint } from './aq';
import type { Activity } from './dose';

export type Verdict = 'go' | 'caution' | 'avoid';

/**
 * The verdict is the stricter of two independent checks.
 *
 * 1. AQI vs effort (from "Boleh Lari?"): the highest zone advised at a US AQI, stricter for sensitive people.
 * 2. Current hourly PM2.5, for zone 1 and above:
 *      go <= 15 ug/m3 (WHO 2021 24-hour guideline), caution <= 35 (US EPA 24-hour standard), avoid above.
 *
 * The US AQI for particulates is a 24-hour average, so it can stay high after the air clears; the PM2.5
 * check reflects what you would breathe now. Both reasons are shown.
 */
export const GO_MAX_PM25 = 15;
export const CAUTION_MAX_PM25 = 35;

/** Highest zone suggested at a given US AQI. 0 means "train indoors". Sensitive = asthma, heart/lung conditions, etc. */
export function maxAdvisedZone(aqi: number, sensitive: boolean): number {
  if (aqi <= 50) return 5;
  if (aqi <= 100) return sensitive ? 3 : 5;
  if (aqi <= 150) return sensitive ? 1 : 2;
  if (aqi <= 200) return sensitive ? 0 : 1;
  return 0;
}

export function maxZoneText(zone: number): string {
  if (zone <= 0) return 'Train indoors';
  return zone >= 5 ? 'Any zone' : `Up to Zone ${zone}`;
}

export interface Recommendation {
  readonly verdict: Verdict;
  /** One-line, plain-language answer. */
  readonly title: string;
  readonly reasons: readonly string[];
}

interface Part {
  readonly level: 0 | 1 | 2;
  readonly title: string;
  readonly reason: string;
}

const VERDICTS: readonly Verdict[] = ['go', 'caution', 'avoid'];

function aqiPart(aqi: number, activity: Activity, sensitive: boolean): Part {
  if (activity.zone === 0) {
    // Resting or easy walking uses a gentler scale.
    const limit = sensitive ? 100 : 150;
    if (aqi <= limit) {
      return { level: 0, title: 'Fine for a walk', reason: `US AQI ${Math.round(aqi)} is within the walking limit of ${limit}.` };
    }
    if (aqi <= 200) {
      return { level: 1, title: 'Short walk only', reason: `US AQI ${Math.round(aqi)} is above ${limit}. Keep it brief; a well-fitted N95 mask helps.` };
    }
    return { level: 2, title: 'Stay indoors', reason: `US AQI ${Math.round(aqi)} is too high to be outside for long.` };
  }
  const advised = maxAdvisedZone(aqi, sensitive);
  const who = sensitive ? 'sensitive profile' : 'general profile';
  const limit = advised >= 5 ? 'any zone' : `Zone ${advised} at most`;
  if (activity.zone <= advised) {
    return {
      level: 0,
      title: 'Good for your run',
      reason: `US AQI ${Math.round(aqi)} (${who}): the advised limit is ${limit}, and you planned Zone ${activity.zone}.`,
    };
  }
  if (advised >= 1) {
    return {
      level: 1,
      title: `Ease off to Zone ${advised}`,
      reason: `US AQI ${Math.round(aqi)} (${who}): the advised limit is ${limit}, but you planned Zone ${activity.zone}. Harder efforts pull in much more haze.`,
    };
  }
  return {
    level: 2,
    title: 'Treadmill day',
    reason: `US AQI ${Math.round(aqi)} (${who}): the air is too hazy for running outside.`,
  };
}

function pmPart(pm25: number): Part {
  if (pm25 <= GO_MAX_PM25) {
    return { level: 0, title: 'Good for your run', reason: `PM2.5 now is ${pm25.toFixed(0)} \u00b5g/m\u00b3, within the WHO 24-hour guideline of ${GO_MAX_PM25}.` };
  }
  if (pm25 <= CAUTION_MAX_PM25) {
    return { level: 1, title: 'Take it easier', reason: `PM2.5 now is ${pm25.toFixed(0)} \u00b5g/m\u00b3, above the WHO guideline of ${GO_MAX_PM25}. Running multiplies how much air you breathe.` };
  }
  return { level: 2, title: 'Wait for cleaner air', reason: `PM2.5 now is ${pm25.toFixed(0)} \u00b5g/m\u00b3, above the US EPA 24-hour standard of ${CAUTION_MAX_PM25}.` };
}

export interface RecommendInput {
  readonly pm25: number;
  readonly usAqi: number;
  readonly activity: Activity;
  readonly sensitive: boolean;
}

export function recommend({ pm25, usAqi, activity, sensitive }: RecommendInput): Recommendation {
  const parts: Part[] = [aqiPart(usAqi, activity, sensitive)];
  // Hourly PM2.5 matters once you are exercising (zone 1 and above).
  if (activity.zone >= 1) parts.push(pmPart(pm25));
  let worst = parts[0] as Part;
  for (const part of parts) if (part.level > worst.level) worst = part;
  return {
    verdict: VERDICTS[worst.level] as Verdict,
    title: worst.title,
    reasons: parts.map((p) => p.reason),
  };
}

export interface BestWindow {
  readonly epoch: number;
  readonly pm25: number;
}

const WINDOW_HOURS = 12;
const EARLIEST_LOCAL_HOUR = 5;
const LATEST_LOCAL_HOUR = 21;

/**
 * The cleanest hour in the next 12 h during typical running hours (05:00-21:00 local),
 * only if it is at least 20% lower than now. Returns null when waiting would not help.
 */
export function bestWindow(
  forecast: readonly HourlyPoint[],
  nowPm25: number,
  now: number,
  utcOffsetSeconds: number,
): BestWindow | null {
  const earliest = now - 30 * 60 * 1000;
  const latest = now + WINDOW_HOURS * 3_600_000;
  let best: HourlyPoint | null = null;
  for (const point of forecast) {
    if (point.epoch < earliest || point.epoch > latest) continue;
    const localHour = new Date(point.epoch + utcOffsetSeconds * 1000).getUTCHours();
    if (localHour < EARLIEST_LOCAL_HOUR || localHour > LATEST_LOCAL_HOUR) continue;
    if (best === null || point.pm25 < best.pm25) best = point;
  }
  if (best === null || best.pm25 > nowPm25 * 0.8) return null;
  return { epoch: best.epoch, pm25: best.pm25 };
}
