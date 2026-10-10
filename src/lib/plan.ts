import { isActivityId, type ActivityId } from './dose';

/** The user's planned session. Saved in the browser (localStorage); nothing leaves the device. */
export interface Plan {
  readonly activity: ActivityId;
  readonly minutes: number;
  readonly age: number;
  /** Asthma, heart or lung conditions, pregnancy, children, older adults: stricter advice. */
  readonly sensitive: boolean;
}

export const DEFAULT_PLAN: Plan = { activity: 'z2', minutes: 45, age: 30, sensitive: false };
export const PLAN_STORAGE_KEY = 'haze-plan-v1';
export const MINUTES_RANGE = [5, 180] as const;
export const AGE_RANGE = [10, 90] as const;

function clampInt(value: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, Math.round(value))) : fallback;
}

/** Turn anything (including corrupt stored data) into a valid plan. */
export function sanitizePlan(raw: unknown): Plan {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PLAN;
  const r = raw as Record<string, unknown>;
  return {
    activity: isActivityId(r['activity']) ? r['activity'] : DEFAULT_PLAN.activity,
    minutes: clampInt(r['minutes'], MINUTES_RANGE, DEFAULT_PLAN.minutes),
    age: clampInt(r['age'], AGE_RANGE, DEFAULT_PLAN.age),
    sensitive: r['sensitive'] === true,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadPlan(storage?: StorageLike): Plan {
  try {
    const store = storage ?? window.localStorage;
    const text = store.getItem(PLAN_STORAGE_KEY);
    return text === null ? DEFAULT_PLAN : sanitizePlan(JSON.parse(text));
  } catch {
    return DEFAULT_PLAN;
  }
}

export function savePlan(plan: Plan, storage?: StorageLike): void {
  try {
    (storage ?? window.localStorage).setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // Storage can be unavailable (private mode, quota). The plan then simply isn't remembered.
  }
}
