import * as THREE from 'three';
import { getActivity, inhaledDoseUg, type Activity, type ActivityId } from '../lib/dose';
import {
  LAKE, PARK_HALF, RUN_SPEED, SIM_MINUTES_PER_SECOND, WALK_SPEED, hazeLevel, inLake, movementActivity,
  readInput, stepPosition, stepsFor, type TimeOfDay,
} from '../lib/walk';
import { createJoystick, type Joystick } from '../ui/joystick';

/**
 * Interactive "Park walk": a stylised KLCC Park with the Petronas Twin Towers behind you.
 * Adapted from the klcc-park-walk demo. Everything is procedural (no external assets) and NOT to scale.
 * Fog, dust and the inhaled-dose counter follow the live air quality of the selected place.
 */
export interface ParkStats {
  /** Stylised distance walked, in world units (not real metres). */
  readonly distance: number;
  readonly steps: number;
  readonly activity: Activity;
  readonly moving: boolean;
  readonly running: boolean;
  /** PM2.5 breathed in so far (ug), with the demo speed-up applied. */
  readonly inhaledUg: number;
}

interface TodPreset {
  readonly sky: number;
  readonly sun: number;
  readonly intensity: number;
  readonly hemi: number;
  readonly pos: readonly [number, number, number];
  readonly glow: number;
}

const TOD: Record<TimeOfDay, TodPreset> = {
  morning: { sky: 0xffd9b0, sun: 0xffe2b8, intensity: 1.6, hemi: 0.7, pos: [60, 30, 40], glow: 0 },
  noon: { sky: 0x9fd0ff, sun: 0xffffff, intensity: 2.2, hemi: 0.9, pos: [20, 90, 20], glow: 0 },
  sunset: { sky: 0xf28c5a, sun: 0xff9a5c, intensity: 1.4, hemi: 0.5, pos: [-70, 18, -20], glow: 0.15 },
  night: { sky: 0x0b1530, sun: 0x8fa8ff, intensity: 0.35, hemi: 0.15, pos: [-30, 60, 30], glow: 1 },
};

const HAZE_COLOR = new THREE.Color(0xb9ad8c);
const DUST_COUNT = 3000;
const STATS_INTERVAL_S = 0.1;
const CAM_OFFSET = new THREE.Vector3(0, 4.5, 9);
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const standard = (color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0, y = 0, z = 0,
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

export class ParkScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 0.8);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly fog = new THREE.Fog(0x9fd0ff, 60, 260);
  private readonly towerMaterial = standard(0xc9d1d9, { metalness: 0.7, roughness: 0.3 });
  private readonly dust: THREE.Points;
  private readonly dustMaterial: THREE.PointsMaterial;
  private readonly player = new THREE.Group();
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private readonly resizeObserver: ResizeObserver;
  private readonly joystick: Joystick;
  private readonly joy = { x: 0, z: 0 };
  private readonly camTarget = new THREE.Vector3();
  private sunOffset = new THREE.Vector3(...TOD.noon.pos);

  private tod: TimeOfDay = 'noon';
  private haze = 0;
  private pm25 = 0;
  private planned: ActivityId = 'z2';
  private runToggle = false;
  private active = false;
  private frame = 0;
  private distance = 0;
  private steps = 0;
  private phase = 0;
  private inhaled = 0;
  private sinceStats = 0;

  constructor(private readonly container: HTMLElement, private readonly onStats: (stats: ParkStats) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.className = 'park-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.fog = this.fog;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });

    this.buildPark();
    this.buildTowers();
    const limbs = this.buildWalker();
    [this.armL, this.armR, this.legL, this.legR] = limbs;

    const positions = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i += 1) {
      positions[i * 3] = (Math.random() * 2 - 1) * 30;
      positions[i * 3 + 1] = Math.random() * 12;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * 30;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustMaterial = new THREE.PointsMaterial({
      color: 0x8a7a55, size: 0.18, transparent: true, opacity: 0, depthWrite: false,
    });
    this.dust = new THREE.Points(dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    this.camera.position.copy(this.player.position).add(CAM_OFFSET);
    this.applyAtmosphere();

    this.joystick = createJoystick(container, (x, y) => {
      this.joy.x = x;
      this.joy.z = y;
    });

    // Keyboard works only while the scene has focus, so typing in the search box never moves the walker.
    container.addEventListener('keydown', this.onKeyDown);
    container.addEventListener('keyup', this.onKeyUp);
    container.addEventListener('blur', this.onBlur);
    container.addEventListener('pointerdown', this.focusScene);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ----- Public API -----
  /** Update from the live reading. Pass null when air quality is unavailable: the park shows clear sky and no dose. */
  setAir(usAqi: number | null, pm25: number | null): void {
    this.haze = usAqi === null ? 0 : hazeLevel(usAqi);
    this.pm25 = pm25 === null || !Number.isFinite(pm25) ? 0 : Math.max(0, pm25);
    this.applyAtmosphere();
  }

  setPlannedActivity(id: ActivityId): void {
    this.planned = id;
  }

  setTimeOfDay(tod: TimeOfDay): void {
    this.tod = tod;
    this.applyAtmosphere();
  }

  setRunToggle(on: boolean): void {
    this.runToggle = on;
  }

  resetWalk(): void {
    this.distance = 0;
    this.steps = 0;
    this.inhaled = 0;
    this.emitStats(false, false);
  }

  /** Render only while the tab is visible. Starts and stops the loop. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.clock.getDelta();
      this.resize();
      this.frame = requestAnimationFrame(this.loop);
    } else {
      cancelAnimationFrame(this.frame);
      this.keys.clear();
    }
  }

  focus(): void {
    this.container.focus({ preventScroll: true });
  }

  dispose(): void {
    this.setActive(false);
    this.resizeObserver.disconnect();
    this.container.removeEventListener('keydown', this.onKeyDown);
    this.container.removeEventListener('keyup', this.onKeyUp);
    this.container.removeEventListener('blur', this.onBlur);
    this.container.removeEventListener('pointerdown', this.focusScene);
    this.joystick.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ----- Input -----
  private readonly focusScene = (): void => this.focus();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  // ----- Scene building -----
  private buildPark(): void {
    const ground = mesh(new THREE.PlaneGeometry(400, 400), standard(0x5d9a46), 0, 0, 0, false);
    ground.rotation.x = -Math.PI / 2;
    const lake = mesh(
      new THREE.CircleGeometry(16, 48), standard(0x3f86c9, { roughness: 0.15, metalness: 0.4 }), LAKE.x, 0.03, LAKE.z, false,
    );
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(1.4, 0.8, 1);
    const pathMaterial = standard(0xd9c7a3);
    const ring = mesh(new THREE.RingGeometry(36, 39, 64), pathMaterial, 0, 0.02, 0, false);
    ring.rotation.x = -Math.PI / 2;
    const straight = mesh(new THREE.PlaneGeometry(3, 120), pathMaterial, -6, 0.02, 0, false);
    straight.rotation.x = -Math.PI / 2;
    this.scene.add(ground, lake, ring, straight);

    // Deterministic pseudo-random trees that avoid the lake and the paths.
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const trunkMaterial = standard(0x6b4a2b);
    const leafMaterials = [standard(0x2f7a32), standard(0x3e8f3a), standard(0x276b2c)];
    const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    const canopyGeometry = new THREE.SphereGeometry(1.8, 8, 6);
    const coneGeometry = new THREE.ConeGeometry(1.6, 4, 7);
    for (let placed = 0, tries = 0; placed < 70 && tries < 2000; tries += 1) {
      const x = (rand() * 2 - 1) * (PARK_HALF + 10);
      const z = (rand() * 2 - 1) * (PARK_HALF + 10);
      const r = Math.hypot(x, z);
      if (inLake(x, z, 3) || (r > 34 && r < 41) || Math.abs(x + 6) < 4 || Math.hypot(x, z - 30) < 8) continue;
      const leafMaterial = leafMaterials[placed % 3] as THREE.Material;
      const tree = new THREE.Group();
      tree.add(mesh(trunkGeometry, trunkMaterial, 0, 1.2, 0));
      tree.add(
        rand() > 0.5
          ? mesh(canopyGeometry, leafMaterial, 0, 3.6, 0)
          : mesh(coneGeometry, leafMaterial, 0, 4.2, 0),
      );
      tree.scale.setScalar(0.8 + rand() * 0.7);
      tree.position.set(x, 0, z);
      this.scene.add(tree);
      placed += 1;
    }
  }

  private buildTowers(): void {
    const buildTower = (x: number): THREE.Group => {
      const g = new THREE.Group();
      let y = 0;
      let r = 9;
      for (let i = 0; i < 9; i += 1) {
        const h = i === 0 ? 40 : 14 - i * 0.6;
        g.add(mesh(new THREE.CylinderGeometry(r * 0.94, r, h, 8), this.towerMaterial, 0, y + h / 2, 0));
        y += h;
        r *= 0.86;
      }
      g.add(mesh(new THREE.ConeGeometry(0.8, 30, 8), this.towerMaterial, 0, y + 15, 0));
      g.position.set(x, 0, -150);
      return g;
    };
    this.scene.add(buildTower(-20), buildTower(20));
    this.scene.add(mesh(new THREE.BoxGeometry(24, 4, 3), this.towerMaterial, 0, 72, -150)); // skybridge
    const backdrop = standard(0x8a96a3, { metalness: 0.3, roughness: 0.5 });
    const blocks: [number, number][] = [[-80, 60], [-55, 45], [60, 50], [85, 70], [-100, 35], [110, 40]];
    for (const [x, h] of blocks) {
      this.scene.add(mesh(new THREE.BoxGeometry(18, h, 18), backdrop, x, h / 2, -140 - Math.abs(x) * 0.2));
    }
  }

  private buildWalker(): [THREE.Group, THREE.Group, THREE.Group, THREE.Group] {
    const skin = standard(0xc68a5e);
    const shirt = standard(0xe9895a);
    const pants = standard(0x2d3a5a);
    this.player.add(mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), shirt, 0, 1.35, 0));
    this.player.add(mesh(new THREE.SphereGeometry(0.25, 12, 10), skin, 0, 2.05, 0));
    const limb = (material: THREE.Material, x: number, y: number, length: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.BoxGeometry(0.2, length, 0.2), material, 0, -length / 2, 0));
      this.player.add(pivot);
      return pivot;
    };
    const armL = limb(skin, -0.47, 1.75, 0.8);
    const armR = limb(skin, 0.47, 1.75, 0.8);
    const legL = limb(pants, -0.18, 0.9, 0.9);
    const legR = limb(pants, 0.18, 0.9, 0.9);
    this.player.position.set(-6, 0, 30);
    this.player.rotation.y = Math.PI; // face the towers
    this.scene.add(this.player);
    return [armL, armR, legL, legR];
  }

  // ----- Atmosphere -----
  private applyAtmosphere(): void {
    const t = TOD[this.tod];
    const k = this.haze;
    const hazeTint = HAZE_COLOR.clone().multiplyScalar(this.tod === 'night' ? 0.3 : 1);
    const sky = new THREE.Color(t.sky).lerp(hazeTint, k * 0.85);
    this.scene.background = sky;
    this.fog.color.copy(sky);
    this.fog.near = THREE.MathUtils.lerp(60, 4, k);
    this.fog.far = THREE.MathUtils.lerp(260, 120, k);
    this.sun.color.set(t.sun).lerp(new THREE.Color(0xffc98a), k * 0.6);
    this.sun.intensity = t.intensity * (1 - 0.6 * k);
    this.hemi.intensity = t.hemi * (1 - 0.3 * k);
    this.sunOffset = new THREE.Vector3(...t.pos);
    this.towerMaterial.emissive.set(0xffd27a);
    this.towerMaterial.emissiveIntensity = t.glow * 0.6;
    this.dustMaterial.opacity = k > 0 ? 0.25 + 0.5 * k : 0;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private emitStats(moving: boolean, running: boolean): void {
    const activity = getActivity(movementActivity(moving, running, this.planned));
    this.onStats({
      distance: this.distance, steps: Math.floor(this.steps), activity, moving, running, inhaledUg: this.inhaled,
    });
  }

  // ----- Loop -----
  private readonly loop = (): void => {
    if (!this.active) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    const input = readInput(this.keys, this.joy);
    const running = this.runToggle || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const moving = input.mag > 0.05;
    const swingScale = reducedMotion ? 0.3 : 1;

    if (moving) {
      const length = Math.hypot(input.x, input.z);
      const dirX = input.x / length;
      const dirZ = input.z / length;
      const speed = (running ? RUN_SPEED : WALK_SPEED) * input.mag;
      const before = { x: this.player.position.x, z: this.player.position.z };
      const next = stepPosition(before, dirX, dirZ, speed, dt);
      this.player.position.x = next.x;
      this.player.position.z = next.z;
      const moved = Math.hypot(next.x - before.x, next.z - before.z);
      this.distance += moved;
      this.steps += stepsFor(moved, running);

      const targetYaw = Math.atan2(dirX, dirZ);
      let delta = targetYaw - this.player.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.player.rotation.y += delta * Math.min(1, dt * 10);

      this.phase += dt * (running ? 13 : 8) * input.mag;
      const swing = Math.sin(this.phase) * (running ? 0.9 : 0.55) * swingScale;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing;
      this.armR.rotation.x = swing;
      this.player.position.y = Math.abs(Math.sin(this.phase)) * (running ? 0.12 : 0.05) * swingScale;
    } else {
      for (const limb of [this.legL, this.legR, this.armL, this.armR]) limb.rotation.x *= 0.85;
      this.player.position.y *= 0.85;
    }

    // Dose: live PM2.5 x breathing rate for what the walker is doing now. Demo runs sped up.
    const activity = getActivity(movementActivity(moving, running, this.planned));
    this.inhaled += inhaledDoseUg(this.pm25, activity.litresPerMinute, dt * SIM_MINUTES_PER_SECOND);

    this.sinceStats += dt;
    if (this.sinceStats >= STATS_INTERVAL_S) {
      this.sinceStats = 0;
      this.emitStats(moving, running);
    }

    // Follow camera, a shadow-casting sun that tracks the walker, and haze dust that drifts with them.
    this.camera.position.lerp(this.camTarget.copy(this.player.position).add(CAM_OFFSET), 1 - Math.exp(-dt * 5));
    this.camera.lookAt(this.player.position.x, this.player.position.y + 1.6, this.player.position.z - 4);
    this.sun.position.copy(this.player.position).add(this.sunOffset);
    this.sun.target.position.copy(this.player.position);
    this.dust.position.set(this.player.position.x, 0, this.player.position.z);
    this.dust.rotation.y += dt * 0.03 * swingScale;

    this.renderer.render(this.scene, this.camera);
  };
}
