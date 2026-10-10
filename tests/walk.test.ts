import { describe, expect, it } from 'vitest';
import {
  LAKE, PARK_HALF, RUN_SPEED, WALK_SPEED, hazeLevel, inLake, isTimeOfDay, movementActivity, organTier, readInput,
  stepPosition, stepsFor,
} from '../src/lib/walk';

const NO_JOY = { x: 0, z: 0 };

describe('input', () => {
  it('maps WASD and arrows, with W / up being -z', () => {
    expect(readInput(new Set(['KeyW']), NO_JOY)).toMatchObject({ x: 0, z: -1, mag: 1 });
    expect(readInput(new Set(['ArrowDown']), NO_JOY)).toMatchObject({ z: 1 });
    expect(readInput(new Set(['KeyA']), NO_JOY)).toMatchObject({ x: -1 });
    expect(readInput(new Set(['ArrowRight']), NO_JOY)).toMatchObject({ x: 1 });
  });
  it('cancels opposite keys and reports no movement', () => {
    const r = readInput(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']), NO_JOY);
    expect(r.mag).toBe(0);
  });
  it('caps strength at 1 for diagonals and honours the joystick', () => {
    expect(readInput(new Set(['KeyW', 'KeyD']), NO_JOY).mag).toBe(1);
    const partial = readInput(new Set(), { x: 0.3, z: 0 });
    expect(partial.mag).toBeCloseTo(0.3, 9);
  });
  it('ignores unrelated keys', () => {
    expect(readInput(new Set(['KeyQ', 'Enter']), NO_JOY).mag).toBe(0);
  });
});

describe('movement', () => {
  it('moves at walking and running speed', () => {
    const walk = stepPosition({ x: 0, z: 0 }, 1, 0, WALK_SPEED, 1);
    expect(walk.x).toBeCloseTo(WALK_SPEED, 9);
    const run = stepPosition({ x: 0, z: 0 }, 1, 0, RUN_SPEED, 1);
    expect(run.x).toBeCloseTo(RUN_SPEED, 9);
  });
  it('stays inside the park', () => {
    const p = stepPosition({ x: PARK_HALF - 0.1, z: 0 }, 1, 0, 100, 1);
    expect(p.x).toBe(PARK_HALF);
    expect(stepPosition({ x: 0, z: -PARK_HALF }, 0, -1, 100, 1).z).toBe(-PARK_HALF);
  });
  it('never enters the lake', () => {
    expect(inLake(LAKE.x, LAKE.z)).toBe(true);
    expect(inLake(0, 30)).toBe(false);
    // Walk straight at the lake from the west edge: must not end up inside.
    let pos: { x: number; z: number } = { x: LAKE.x - LAKE.rx - 1, z: LAKE.z };
    for (let i = 0; i < 400; i += 1) pos = stepPosition(pos, 1, 0, WALK_SPEED, 0.05);
    expect(inLake(pos.x, pos.z)).toBe(false);
  });
  it('slides along the lake edge instead of stopping dead', () => {
    // Just outside the lake's west edge, heading diagonally into it: the z component should still move us.
    const start = { x: LAKE.x - LAKE.rx - 0.05, z: LAKE.z };
    const dir = Math.SQRT1_2;
    const next = stepPosition(start, dir, dir, WALK_SPEED, 0.5);
    expect(inLake(next.x, next.z)).toBe(false);
    expect(next.x !== start.x || next.z !== start.z).toBe(true);
  });
  it('counts more steps per distance when walking than running', () => {
    expect(stepsFor(7.5, false)).toBeCloseTo(10, 9);
    expect(stepsFor(7.5, true)).toBeLessThan(stepsFor(7.5, false));
    expect(stepsFor(-1, false)).toBe(0);
    expect(stepsFor(NaN, true)).toBe(0);
  });
});

describe('haze and organs', () => {
  it('scales haze with AQI and saturates at 200', () => {
    expect(hazeLevel(0)).toBe(0);
    expect(hazeLevel(100)).toBeCloseTo(0.5, 9);
    expect(hazeLevel(500)).toBe(1);
    expect(hazeLevel(-5)).toBe(0);
    expect(hazeLevel(NaN)).toBe(0);
  });
  it('picks an organ render only when the air is not good', () => {
    expect(organTier(30)).toBeNull();
    expect(organTier(50)).toBeNull();
    expect(organTier(51)).toBe(100);
    expect(organTier(125)).toBe(100);
    expect(organTier(126)).toBe(150);
    expect(organTier(175)).toBe(150);
    expect(organTier(176)).toBe(200);
    expect(organTier(400)).toBe(200);
    expect(organTier(NaN)).toBeNull();
  });
});

describe('breathing while moving', () => {
  it('rests when idle, walks when moving, uses the planned zone when running', () => {
    expect(movementActivity(false, true, 'z4')).toBe('rest');
    expect(movementActivity(true, false, 'z4')).toBe('walk');
    expect(movementActivity(true, true, 'z4')).toBe('z4');
  });
  it('falls back to zone 2 when running with a rest or walk plan', () => {
    expect(movementActivity(true, true, 'rest')).toBe('z2');
    expect(movementActivity(true, true, 'walk')).toBe('z2');
  });
});

describe('time of day', () => {
  it('validates presets', () => {
    expect(isTimeOfDay('sunset')).toBe(true);
    expect(isTimeOfDay('midnight')).toBe(false);
    expect(isTimeOfDay(undefined)).toBe(false);
  });
});
