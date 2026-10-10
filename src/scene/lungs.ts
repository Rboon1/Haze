import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Activity } from '../lib/dose';

/**
 * Stylised (not anatomically exact) 3D human with breathing lungs.
 * Everything is procedural: no external model, no licence concerns.
 */
export interface SceneInput {
  /** 0 clean .. 1 hazardous */
  readonly severity: number;
  /** Current PM2.5 in ug/m3, drives how many particles are drawn. */
  readonly pm25: number;
  readonly activity: Activity;
}

const HEALTHY = new THREE.Color('#e7919f');
const IRRITATED = new THREE.Color('#b8434f');
const SOOT = new THREE.Color('#3b312d');
const PARTICLE_COUNT = 520;

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Cheap deterministic pseudo-noise in roughly [0, 1]. */
function noise3(x: number, y: number, z: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

interface Lung {
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  readonly soot: Float32Array;
}

function buildLung(side: 1 | -1): Lung {
  const geometry = new THREE.SphereGeometry(1, 56, 40);
  const pos = geometry.getAttribute('position');
  const soot = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const t = (y + 1) / 2; // 0 bottom .. 1 top
    // Wide near the lower-middle, narrow apex, flatter back to front.
    const width = 0.4 * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.12)));
    x *= width;
    y *= 0.72;
    z *= 0.36 * (0.75 + 0.25 * Math.sin(Math.PI * t));
    // Medial side (towards the centre) is flattened and notched.
    if (x * side < 0) {
      x *= 0.55;
      if (t > 0.35 && t < 0.7) x *= 0.8;
    }
    // Lobe-like undulation.
    const lobe = 1 + 0.045 * Math.sin(y * 7 + side) + 0.03 * Math.sin(x * 11 + z * 9);
    x *= lobe;
    z *= lobe;
    pos.setXYZ(i, x, y, z);
    const patch = Math.sin(x * 9 + side * 2) * Math.sin(y * 6 + 1.3) * Math.sin(z * 11 - 0.7);
    soot[i] = Math.min(1, Math.max(0, 0.5 + patch * 0.9 + (noise3(x, y, z) - 0.5) * 0.5));
  }
  geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    emissive: new THREE.Color('#2a0b10'),
    emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(side * 0.43, 3.45, 0.02);
  return { group, geometry, soot };
}

function capsule(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 20), material);
}

function buildBody(): THREE.Group {
  const body = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x9bb7d4,
    transparent: true,
    opacity: 0.17,
    roughness: 0.35,
    metalness: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 24), material);
  head.position.set(0, 5.25, 0);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.45, 20), material);
  neck.position.set(0, 4.7, 0);
  const torso = capsule(0.72, 1.5, material);
  torso.scale.set(1.18, 1, 0.64);
  torso.position.set(0, 3.35, 0);
  body.add(head, neck, torso);
  for (const side of [-1, 1]) {
    const arm = capsule(0.17, 1.55, material);
    arm.position.set(side * 1.28, 3.35, 0);
    arm.rotation.z = side * 0.12;
    const leg = capsule(0.27, 1.55, material);
    leg.position.set(side * 0.38, 1.05, 0);
    body.add(arm, leg);
  }
  return body;
}

function buildAirway(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xd9a0a8, roughness: 0.6 });
  const trachea = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.25, 16), material);
  trachea.position.set(0, 4.3, 0.02);
  group.add(trachea);
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 3.7, 0.02),
      new THREE.Vector3(side * 0.18, 3.62, 0.02),
      new THREE.Vector3(side * 0.36, 3.45, 0.02),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.055, 10, false), material));
  }
  return group;
}

export class LungScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly lungs: readonly [Lung, Lung];
  private readonly particles: THREE.Points;
  private readonly particleU = new Float32Array(PARTICLE_COUNT);
  private readonly particleSide = new Int8Array(PARTICLE_COUNT);
  private readonly particleStart = new Float32Array(PARTICLE_COUNT * 3);
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private paused = false;
  private phase = 0;
  private input: SceneInput;
  private colourSeverity = -1;

  constructor(private readonly container: HTMLElement, initial: SceneInput) {
    this.input = initial;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 3.0, 12.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 2.9, 0);
    this.controls.enablePan = false;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 16;
    this.controls.minPolarAngle = Math.PI * 0.25;
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x1b1f2b, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 6, 6);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
    rim.position.set(-4, 4, -5);
    this.scene.add(key, rim);

    this.scene.add(buildBody(), buildAirway());
    this.lungs = [buildLung(-1), buildLung(1)];
    this.scene.add(this.lungs[0].group, this.lungs[1].group);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3));
    this.particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xd8c3a5, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false,
      }),
    );
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    for (let i = 0; i < PARTICLE_COUNT; i += 1) this.respawn(i, true);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.applyColours(initial.severity);
    this.loop();
  }

  /** Stop rendering while another view is shown, and resume without a time jump. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
    } else {
      this.clock.getDelta();
      this.resize();
      this.loop();
    }
  }

  update(input: SceneInput): void {
    this.input = input;
    if (Math.abs(input.severity - this.colourSeverity) > 0.001) this.applyColours(input.severity);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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

  private applyColours(severity: number): void {
    this.colourSeverity = severity;
    const base = new THREE.Color().copy(HEALTHY).lerp(IRRITATED, smoothstep(0, 0.6, severity));
    const tmp = new THREE.Color();
    for (const lung of this.lungs) {
      const colours = lung.geometry.getAttribute('color');
      for (let i = 0; i < colours.count; i += 1) {
        const darkness = Math.min(1, Math.pow(severity, 1.1) * (lung.soot[i] ?? 0) * 1.35);
        tmp.copy(base).lerp(SOOT, darkness);
        colours.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      colours.needsUpdate = true;
    }
  }

  private respawn(i: number, scatter: boolean): void {
    this.particleU[i] = scatter ? Math.random() : 0;
    this.particleSide[i] = Math.random() < 0.5 ? -1 : 1;
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.4 + Math.random() * 1.1;
    this.particleStart[i * 3] = Math.cos(angle) * radius;
    this.particleStart[i * 3 + 1] = 6.3 + Math.random() * 0.9;
    this.particleStart[i * 3 + 2] = 1.0 + Math.abs(Math.sin(angle)) * radius;
  }

  private particlePosition(i: number, out: THREE.Vector3): void {
    const u = this.particleU[i] ?? 0;
    const side = this.particleSide[i] ?? 1;
    const sx = this.particleStart[i * 3] ?? 0;
    const sy = this.particleStart[i * 3 + 1] ?? 6.5;
    const sz = this.particleStart[i * 3 + 2] ?? 1.2;
    if (u < 0.35) {
      const t = u / 0.35;
      out.set(sx * (1 - t), sy + (5.02 - sy) * t, sz + (0.44 - sz) * t);
    } else if (u < 0.65) {
      const t = (u - 0.35) / 0.3;
      out.set(0, 5.02 - 1.3 * t, 0.44 - 0.42 * t);
    } else {
      const t = (u - 0.65) / 0.35;
      out.set(side * 0.43 * t, 3.72 - 0.27 * t, 0.02);
    }
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const { activity, severity, pm25 } = this.input;

    const bpm = reducedMotion ? 6 : activity.breathsPerMinute;
    this.phase += dt * (bpm / 60) * Math.PI * 2;
    // Smooth 0..1 inflation; inhaling while sin(phase) > 0.
    const inflation = (1 - Math.cos(this.phase)) / 2;
    const inhaleFlow = Math.max(0, Math.sin(this.phase));
    const depth =
      Math.min(0.14, 0.035 + (activity.litresPerMinute / 60) * 0.06) * (1 - 0.3 * severity) * (reducedMotion ? 0.4 : 1);
    for (const lung of this.lungs) {
      lung.group.scale.set(1 + depth * 0.6 * inflation, 1 + depth * inflation, 1 + depth * 0.9 * inflation);
    }

    const visible = Math.round(PARTICLE_COUNT * Math.min(1, Math.max(0, pm25 / 120)));
    const speed = (0.25 + activity.litresPerMinute / 60) * 0.7 * (reducedMotion ? 0.3 : 1);
    const positions = this.particles.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const next = (this.particleU[i] ?? 0) + dt * speed * inhaleFlow;
      if (next >= 1) this.respawn(i, false);
      else this.particleU[i] = next;
      this.particlePosition(i, v);
      positions.setXYZ(i, v.x, v.y, v.z);
    }
    positions.needsUpdate = true;
    this.particles.geometry.setDrawRange(0, visible);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
