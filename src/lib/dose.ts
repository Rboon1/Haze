/**
 * Effort-zone, breathing and dose model (adapted from the "Boleh Lari?" project).
 *
 * Population averages for a healthy adult, for relative comparison, NOT medical advice.
 *  - HRmax = 208 - 0.7 x age (Tanaka et al. 2001)
 *  - Air breathed per minute by intensity: ballpark ranges from the US EPA Exposure Factors Handbook
 *  - Switch to mouth breathing at roughly 35 L/min (Niinimaa et al. 1980)
 *  - The "share that stays in the lungs" per zone is an ASSUMPTION that rises with effort
 *    (direction supported by Daigle et al. 2003); the exact fractions are not measured values.
 *
 * Inhaled PM2.5 (ug) = concentration (ug/m3) x air breathed (m3). That is air breathed in,
 * not what stays in the lungs; "retained" applies the assumed share on top.
 */
export type Breathing = 'Nose' | 'Nose + mouth' | 'Mouth';
export type ActivityId = 'rest' | 'walk' | 'z1' | 'z2' | 'z3' | 'z4' | 'z5';

export interface Activity {
  readonly id: ActivityId;
  /** Full label, e.g. "Zone 2 · Aerobic base". */
  readonly label: string;
  /** Compact label for buttons. */
  readonly shortLabel: string;
  /** Heart-rate zone 1-5, or 0 for rest and easy walking. */
  readonly zone: number;
  readonly feel: string;
  readonly litresPerMinute: number;
  /** Breaths per minute (assumption), drives the animation. */
  readonly breathsPerMinute: number;
  readonly breathing: Breathing;
  /** Assumed share of inhaled PM2.5 that stays in the airways and lungs. */
  readonly retained: number;
  /** Percent of HRmax, zones only. */
  readonly hrLowPct?: number;
  readonly hrHighPct?: number;
}

export const REST_LITRES_PER_MINUTE = 7;
export const REST_RETAINED = 0.2;

export const ACTIVITIES: readonly Activity[] = [
  { id: 'rest', label: 'Resting', shortLabel: 'Rest', zone: 0, feel: 'Sitting quietly',
    litresPerMinute: 7, breathsPerMinute: 14, breathing: 'Nose', retained: 0.2 },
  { id: 'walk', label: 'Easy walk', shortLabel: 'Walk', zone: 0, feel: 'A relaxed stroll',
    litresPerMinute: 16, breathsPerMinute: 18, breathing: 'Nose', retained: 0.22 },
  { id: 'z1', label: 'Zone 1 · Recovery', shortLabel: 'Z1', zone: 1, feel: 'Brisk walk or easy jog, full sentences',
    litresPerMinute: 25, breathsPerMinute: 20, breathing: 'Nose', retained: 0.25, hrLowPct: 50, hrHighPct: 60 },
  { id: 'z2', label: 'Zone 2 · Aerobic base', shortLabel: 'Z2', zone: 2, feel: 'Easy run, can chat',
    litresPerMinute: 40, breathsPerMinute: 26, breathing: 'Nose + mouth', retained: 0.3, hrLowPct: 60, hrHighPct: 70 },
  { id: 'z3', label: 'Zone 3 · Tempo', shortLabel: 'Z3', zone: 3, feel: 'Short phrases only',
    litresPerMinute: 60, breathsPerMinute: 32, breathing: 'Mouth', retained: 0.35, hrLowPct: 70, hrHighPct: 80 },
  { id: 'z4', label: 'Zone 4 · Threshold', shortLabel: 'Z4', zone: 4, feel: 'A few words at a time',
    litresPerMinute: 85, breathsPerMinute: 40, breathing: 'Mouth', retained: 0.4, hrLowPct: 80, hrHighPct: 90 },
  { id: 'z5', label: 'Zone 5 · VO2 max', shortLabel: 'Z5', zone: 5, feel: 'All-out, no talking',
    litresPerMinute: 120, breathsPerMinute: 48, breathing: 'Mouth', retained: 0.45, hrLowPct: 90, hrHighPct: 100 },
];

export function isActivityId(value: unknown): value is ActivityId {
  return typeof value === 'string' && ACTIVITIES.some((a) => a.id === value);
}

export function getActivity(id: ActivityId): Activity {
  const found = ACTIVITIES.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown activity: ${id}`);
  return found;
}

/** Popular rule of thumb (Berkeley Earth): ~22 ug/m3 of PM2.5 over 24 h ~ 1 cigarette. Not a medical measure. */
export const PM25_UG_M3_PER_CIGARETTE_PER_DAY = 22;

/** Micrograms inhaled at rest over 24 h at the rule-of-thumb concentration, i.e. one "cigarette". */
export const UG_PER_CIGARETTE =
  PM25_UG_M3_PER_CIGARETTE_PER_DAY * ((REST_LITRES_PER_MINUTE * 60 * 24) / 1000);

/** Micrograms of PM2.5 breathed in. Returns 0 for non-finite or negative inputs. */
export function inhaledDoseUg(pm25UgM3: number, litresPerMinute: number, minutes: number): number {
  if (![pm25UgM3, litresPerMinute, minutes].every(Number.isFinite)) return 0;
  if (pm25UgM3 < 0 || litresPerMinute < 0 || minutes < 0) return 0;
  return pm25UgM3 * (litresPerMinute / 1000) * minutes;
}

/** Micrograms estimated to stay in the airways and lungs (inhaled x assumed retained share). */
export function retainedDoseUg(inhaledUg: number, activity: Activity): number {
  return Number.isFinite(inhaledUg) && inhaledUg > 0 ? inhaledUg * activity.retained : 0;
}

export function cigaretteEquivalent(inhaledUg: number): number {
  return Number.isFinite(inhaledUg) && inhaledUg > 0 ? inhaledUg / UG_PER_CIGARETTE : 0;
}

/** Cigarettes per day if this concentration lasted 24 h at rest (the usual headline figure). */
export function cigarettesPerDayAtRest(pm25UgM3: number): number {
  return Number.isFinite(pm25UgM3) && pm25UgM3 > 0
    ? pm25UgM3 / PM25_UG_M3_PER_CIGARETTE_PER_DAY
    : 0;
}

/** Hours of sitting still in the same air that would leave the same amount in the lungs. */
export function sittingHoursEquivalent(activity: Activity, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return (activity.litresPerMinute * minutes * activity.retained) / (REST_LITRES_PER_MINUTE * 60 * REST_RETAINED);
}

export function hrMax(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/** Heart-rate range in bpm for a zone, or null for rest and easy walking. */
export function zoneBpm(activity: Activity, age: number): [number, number] | null {
  if (activity.hrLowPct === undefined || activity.hrHighPct === undefined) return null;
  const max = hrMax(age);
  return [Math.round((activity.hrLowPct / 100) * max), Math.round((activity.hrHighPct / 100) * max)];
}

/** Rough effort from speed, used to turn a running pace into a breathing level. Fitness changes this a lot. */
export function activityForSpeed(kmh: number): ActivityId {
  if (!Number.isFinite(kmh) || kmh <= 0) return 'z2';
  if (kmh < 1) return 'rest';
  if (kmh < 4.5) return 'walk';
  if (kmh < 6.5) return 'z1';
  if (kmh < 8.5) return 'z2';
  if (kmh < 11) return 'z3';
  if (kmh < 14) return 'z4';
  return 'z5';
}

export function activityForPace(minutesPerKm: number): ActivityId {
  if (!Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return 'z2';
  return activityForSpeed(60 / minutesPerKm);
}
