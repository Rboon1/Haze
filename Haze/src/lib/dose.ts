/**
 * Inhaled-dose model. Deliberately simple and transparent.
 *
 * Inhaled PM2.5 (ug) = concentration (ug/m3) x minute ventilation (m3/min) x minutes.
 * It is the amount breathed in, not the amount that deposits in the lungs.
 *
 * Breathing rates are typical adult ballpark figures, not individual measurements.
 */
export type ActivityId = 'rest' | 'walk' | 'jog' | 'run';

export interface Activity {
  readonly id: ActivityId;
  readonly label: string;
  /** Minute ventilation in litres per minute (assumption). */
  readonly litresPerMinute: number;
  /** Breaths per minute (assumption), drives the animation. */
  readonly breathsPerMinute: number;
}

export const ACTIVITIES: readonly Activity[] = [
  { id: 'rest', label: 'Resting', litresPerMinute: 7.5, breathsPerMinute: 14 },
  { id: 'walk', label: 'Walking', litresPerMinute: 20, breathsPerMinute: 20 },
  { id: 'jog', label: 'Jogging', litresPerMinute: 40, breathsPerMinute: 30 },
  { id: 'run', label: 'Running', litresPerMinute: 60, breathsPerMinute: 40 },
];

export const REST_LITRES_PER_MINUTE = 7.5;

/** Popular rule of thumb (Berkeley Earth): ~22 ug/m3 of PM2.5 over 24 h ~ 1 cigarette. Not a medical measure. */
export const PM25_UG_M3_PER_CIGARETTE_PER_DAY = 22;

/** Micrograms inhaled at rest over 24 h at the rule-of-thumb concentration, i.e. one "cigarette". */
export const UG_PER_CIGARETTE =
  PM25_UG_M3_PER_CIGARETTE_PER_DAY * ((REST_LITRES_PER_MINUTE * 60 * 24) / 1000);

export function getActivity(id: ActivityId): Activity {
  const found = ACTIVITIES.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown activity: ${id}`);
  return found;
}

/** Micrograms of PM2.5 breathed in. Returns 0 for non-finite or negative inputs. */
export function inhaledDoseUg(pm25UgM3: number, litresPerMinute: number, minutes: number): number {
  if (![pm25UgM3, litresPerMinute, minutes].every(Number.isFinite)) return 0;
  if (pm25UgM3 < 0 || litresPerMinute < 0 || minutes < 0) return 0;
  return pm25UgM3 * (litresPerMinute / 1000) * minutes;
}

export function cigaretteEquivalent(doseUg: number): number {
  return Number.isFinite(doseUg) && doseUg > 0 ? doseUg / UG_PER_CIGARETTE : 0;
}

/** Cigarettes per day if this concentration lasted 24 h at rest (the usual headline figure). */
export function cigarettesPerDayAtRest(pm25UgM3: number): number {
  return Number.isFinite(pm25UgM3) && pm25UgM3 > 0
    ? pm25UgM3 / PM25_UG_M3_PER_CIGARETTE_PER_DAY
    : 0;
}

/** Map a running pace (min per km) to a breathing level. */
export function activityForPace(minutesPerKm: number): ActivityId {
  if (!Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return 'jog';
  if (minutesPerKm >= 10) return 'walk';
  if (minutesPerKm >= 7) return 'jog';
  return 'run';
}
