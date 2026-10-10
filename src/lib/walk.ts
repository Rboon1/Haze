import { getActivity, type ActivityId } from './dose';

/**
 * Pure logic for the "Park walk" scene (adapted from the klcc-park-walk demo).
 * The scene is stylised and NOT to scale: distances are world units, not real metres.
 */
export const PARK_HALF = 60;
export const LAKE = { x: 18, z: -18, rx: 16 * 1.4, rz: 16 * 0.8 } as const;
export const WALK_SPEED = 2.8;
export const RUN_SPEED = 7;
/** Demo speed-up so the dose moves visibly: 1 real second counts as 1 simulated minute. */
export const SIM_MINUTES_PER_SECOND = 1;

export type TimeOfDay = 'morning' | 'noon' | 'sunset' | 'night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'noon', 'sunset', 'night'];

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && (TIMES_OF_DAY as readonly string[]).includes(value);
}

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export function inLake(x: number, z: number, margin = 0): boolean {
  return ((x - LAKE.x) / (LAKE.rx + margin)) ** 2 + ((z - LAKE.z) / (LAKE.rz + margin)) ** 2 < 1;
}

export interface InputState {
  /** Movement intent, each in -1..1. W / up is -z. */
  readonly x: number;
  readonly z: number;
  /** Strength 0..1. */
  readonly mag: number;
}

/** Combine keys and the on-screen joystick into one movement intent. */
export function readInput(keys: ReadonlySet<string>, joy: Vec2): InputState {
  let x = joy.x;
  let z = joy.z;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  const length = Math.hypot(x, z);
  return { x, z, mag: Math.min(length, 1) };
}

/**
 * Move one step. Stays inside the park and out of the lake. If the lake blocks the direct move,
 * slide along one axis instead of stopping dead.
 */
export function stepPosition(pos: Vec2, dirX: number, dirZ: number, speed: number, dt: number): Vec2 {
  const clampPark = (v: number): number => Math.min(PARK_HALF, Math.max(-PARK_HALF, v));
  const nx = clampPark(pos.x + dirX * speed * dt);
  const nz = clampPark(pos.z + dirZ * speed * dt);
  if (!inLake(nx, nz)) return { x: nx, z: nz };
  if (!inLake(nx, pos.z)) return { x: nx, z: pos.z };
  if (!inLake(pos.x, nz)) return { x: pos.x, z: nz };
  return pos;
}

/** 0 (clear) to 1 (thick haze). Saturates at US AQI 200. */
export function hazeLevel(usAqi: number): number {
  if (!Number.isFinite(usAqi)) return 0;
  return Math.min(1, Math.max(0, usAqi / 200));
}

export type OrganTier = 100 | 150 | 200;

/** Which illustrative organ render to show for the live US AQI. No image when the air is good. */
export function organTier(usAqi: number): OrganTier | null {
  if (!Number.isFinite(usAqi) || usAqi <= 50) return null;
  if (usAqi <= 125) return 100;
  if (usAqi <= 175) return 150;
  return 200;
}

/** Breathing level while moving: idle is rest, walking is the walk level, running uses the user's plan. */
export function movementActivity(moving: boolean, running: boolean, planned: ActivityId): ActivityId {
  if (!moving) return 'rest';
  if (!running) return 'walk';
  return getActivity(planned).zone >= 1 ? planned : 'z2';
}

export function stepsFor(distance: number, running: boolean): number {
  return Number.isFinite(distance) && distance > 0 ? distance / (running ? 1.1 : 0.75) : 0;
}
