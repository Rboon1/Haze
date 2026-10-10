// KLCC Park Walk: procedural three.js scene (no external assets).
import * as THREE from 'three';
import { inhaledDoseUg, cigaretteEquivalent, getActivity } from './lib/dose.js';
import { recommend } from './lib/recommend.js';
import { formatDose, formatCigarettes } from './lib/format.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd0ff, 60, 260);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

// ---------- Lights ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
scene.add(sun, sun.target);

// ---------- Helpers ----------
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
function mesh(geo, material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// ---------- Park ----------
const PARK = 60; // half-size of walkable area
const ground = mesh(new THREE.PlaneGeometry(400, 400), mat(0x5d9a46), 0, 0, 0, false);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const lake = mesh(new THREE.CircleGeometry(16, 48), mat(0x3f86c9, { roughness: 0.15, metalness: 0.4 }), 18, 0.03, -18, false);
lake.rotation.x = -Math.PI / 2;
lake.scale.set(1.4, 0.8, 1);
scene.add(lake);
const LAKE = { x: 18, z: -18, rx: 16 * 1.4, rz: 16 * 0.8 };

const pathMat = mat(0xd9c7a3);
const ring = mesh(new THREE.RingGeometry(36, 39, 64), pathMat, 0, 0.02, 0, false);
ring.rotation.x = -Math.PI / 2;
scene.add(ring);
const straight = mesh(new THREE.PlaneGeometry(3, 120), pathMat, -6, 0.02, 0, false);
straight.rotation.x = -Math.PI / 2;
scene.add(straight);

// Trees, deterministic pseudo-random placement avoiding lake and paths.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const trunkMat = mat(0x6b4a2b);
const leafMats = [mat(0x2f7a32), mat(0x3e8f3a), mat(0x276b2c)];
const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
const canopyGeo = new THREE.SphereGeometry(1.8, 8, 6);
const coneGeo = new THREE.ConeGeometry(1.6, 4, 7);
for (let placed = 0, tries = 0; placed < 70 && tries < 2000; tries++) {
  const x = (rand() * 2 - 1) * (PARK + 10);
  const z = (rand() * 2 - 1) * (PARK + 10);
  const r = Math.hypot(x, z);
  const inLake = ((x - LAKE.x) / (LAKE.rx + 3)) ** 2 + ((z - LAKE.z) / (LAKE.rz + 3)) ** 2 < 1;
  if (inLake || (r > 34 && r < 41) || Math.abs(x + 6) < 4 || Math.hypot(x, z - 30) < 8) continue;
  const tree = new THREE.Group();
  tree.add(mesh(trunkGeo, trunkMat, 0, 1.2, 0));
  const leaves = rand() > 0.5 ? mesh(canopyGeo, leafMats[placed % 3], 0, 3.6, 0) : mesh(coneGeo, leafMats[placed % 3], 0, 4.2, 0);
  tree.add(leaves);
  const s = 0.8 + rand() * 0.7;
  tree.scale.setScalar(s);
  tree.position.set(x, 0, z);
  scene.add(tree);
  placed++;
}

// ---------- Twin towers ----------
const towerMat = mat(0xc9d1d9, { metalness: 0.7, roughness: 0.3, emissive: 0x000000 });
function buildTower(x) {
  const g = new THREE.Group();
  let y = 0, r = 9;
  for (let i = 0; i < 9; i++) {
    const h = i === 0 ? 40 : 14 - i * 0.6;
    g.add(mesh(new THREE.CylinderGeometry(r * 0.94, r, h, 8), towerMat, 0, y + h / 2, 0));
    y += h;
    r *= 0.86;
  }
  const spire = mesh(new THREE.ConeGeometry(0.8, 30, 8), towerMat, 0, y + 15, 0);
  g.add(spire);
  g.position.set(x, 0, -150);
  return g;
}
scene.add(buildTower(-20), buildTower(20));
scene.add(mesh(new THREE.BoxGeometry(24, 4, 3), towerMat, 0, 72, -150)); // skybridge

const bgMat = mat(0x8a96a3, { metalness: 0.3, roughness: 0.5 });
[[-80, 60], [-55, 45], [60, 50], [85, 70], [-100, 35], [110, 40]].forEach(([x, h]) => {
  scene.add(mesh(new THREE.BoxGeometry(18, h, 18), bgMat, x, h / 2, -140 - Math.abs(x) * 0.2));
});

// ---------- Character ----------
const player = new THREE.Group();
const skin = mat(0xc68a5e), shirt = mat(0xe9895a), pants = mat(0x2d3a5a);
player.add(mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), shirt, 0, 1.35, 0));
player.add(mesh(new THREE.SphereGeometry(0.25, 12, 10), skin, 0, 2.05, 0));
function limb(material, x, y, len) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(mesh(new THREE.BoxGeometry(0.2, len, 0.2), material, 0, -len / 2, 0));
  player.add(pivot);
  return pivot;
}
const armL = limb(skin, -0.47, 1.75, 0.8), armR = limb(skin, 0.47, 1.75, 0.8);
const legL = limb(pants, -0.18, 0.9, 0.9), legR = limb(pants, 0.18, 0.9, 0.9);
player.position.set(-6, 0, 30);
player.rotation.y = Math.PI; // face the towers
scene.add(player);

// ---------- HUD + input ----------
const $ = (id) => document.getElementById(id);
const modeEl = $('mode'), distEl = $('dist'), stepsEl = $('steps'), runBtn = $('runBtn');
const keys = new Set();
let runToggle = false;
const joyVec = { x: 0, y: 0 };

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

runBtn.addEventListener('click', () => {
  runToggle = !runToggle;
  runBtn.setAttribute('aria-pressed', String(runToggle));
});

const joy = $('joy'), knob = joy.querySelector('.knob');
let joyId = null;
function joyMove(e) {
  const rect = joy.getBoundingClientRect();
  const R = rect.width / 2;
  let dx = e.clientX - (rect.left + R), dy = e.clientY - (rect.top + R);
  const len = Math.hypot(dx, dy);
  if (len > R) { dx *= R / len; dy *= R / len; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  joyVec.x = dx / R;
  joyVec.y = dy / R;
}
function joyEnd() {
  joyId = null;
  joyVec.x = joyVec.y = 0;
  knob.style.transform = '';
}
joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(joyId); joyMove(e); });
joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
joy.addEventListener('pointerup', joyEnd);
joy.addEventListener('pointercancel', joyEnd);

// ---------- Time of day ----------
const TOD = {
  morning: { sky: 0xffd9b0, sun: 0xffe2b8, int: 1.6, hemi: 0.7, pos: [60, 30, 40], glow: 0 },
  noon:    { sky: 0x9fd0ff, sun: 0xffffff, int: 2.2, hemi: 0.9, pos: [20, 90, 20], glow: 0 },
  sunset:  { sky: 0xf28c5a, sun: 0xff9a5c, int: 1.4, hemi: 0.5, pos: [-70, 18, -20], glow: 0.15 },
  night:   { sky: 0x0b1530, sun: 0x8fa8ff, int: 0.35, hemi: 0.15, pos: [-30, 60, 30], glow: 1 },
};
let sunOffset = new THREE.Vector3(...TOD.noon.pos);
let tod = 'noon';
let aqi = 0; // 0 = sunny / clear, else 100 | 150 | 200 (from the Haze edition)
const HAZE_COLOR = new THREE.Color(0xb9ad8c);
// Approximate PM2.5 concentration (µg/m³) at each AQI breakpoint.
const PM25 = { 0: 8, 100: 35, 150: 55, 200: 150 };
const AQI_NOTE = { 100: 'Moderate', 150: 'Unhealthy for sensitive groups', 200: 'Unhealthy' };

function applyAtmosphere() {
  const t = TOD[tod];
  const k = aqi / 200; // haze strength 0..1
  const sky = new THREE.Color(t.sky).lerp(HAZE_COLOR.clone().multiplyScalar(tod === 'night' ? 0.3 : 1), k * 0.85);
  scene.background = sky;
  scene.fog.color.copy(sky);
  scene.fog.near = THREE.MathUtils.lerp(60, 4, k);
  scene.fog.far = THREE.MathUtils.lerp(260, 120, k);
  sun.color.set(t.sun).lerp(new THREE.Color(0xffc98a), k * 0.6);
  sun.intensity = t.int * (1 - 0.6 * k);
  hemi.intensity = t.hemi * (1 - 0.3 * k);
  sunOffset = new THREE.Vector3(...t.pos);
  towerMat.emissive.set(0xffd27a);
  towerMat.emissiveIntensity = t.glow * 0.6;
}

function setTod(name) {
  tod = name;
  applyAtmosphere();
  document.querySelectorAll('[data-tod]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tod === name)));
}

const organs = $('organs');
function setAqi(level) {
  aqi = level;
  applyAtmosphere();
  document.querySelectorAll('[data-aqi]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.aqi) === level)));
  organs.hidden = level === 0;
  if (level) {
    $('lungsImg').src = `./lungs/lungs_${level}.jpg`;
    $('heartImg').src = `./heart/heart_${level}.jpg`;
    $('aqiNote').textContent = `AQI ${level} · ${AQI_NOTE[level]}`;
    const r = recommend(PM25[level], level);
    const v = $('verdict');
    v.textContent = { go: 'GO', caution: 'CAUTION', avoid: 'AVOID' }[r.verdict];
    v.dataset.v = r.verdict;
    $('reason').textContent = r.reasons[0];
  }
  hazeMat.opacity = level ? 0.25 + 0.5 * (level / 200) : 0;
}

// ---------- Haze particles (drift around the walker, density follows AQI) ----------
const HAZE_N = 3000;
const hazePos = new Float32Array(HAZE_N * 3);
for (let i = 0; i < HAZE_N; i++) {
  hazePos[i * 3] = (Math.random() * 2 - 1) * 30;
  hazePos[i * 3 + 1] = Math.random() * 12;
  hazePos[i * 3 + 2] = (Math.random() * 2 - 1) * 30;
}
const hazeGeo = new THREE.BufferGeometry();
hazeGeo.setAttribute('position', new THREE.BufferAttribute(hazePos, 3));
const hazeMat = new THREE.PointsMaterial({ color: 0x8a7a55, size: 0.18, transparent: true, opacity: 0, depthWrite: false });
const haze = new THREE.Points(hazeGeo, hazeMat);
scene.add(haze);
document.querySelectorAll('[data-tod]').forEach((b) => b.addEventListener('click', () => setTod(b.dataset.tod)));
document.querySelectorAll('[data-aqi]').forEach((b) => b.addEventListener('click', () => setAqi(Number(b.dataset.aqi))));
// Optional deep link for demos, e.g. ?aqi=200&tod=sunset
const params = new URLSearchParams(location.search);
setTod(TOD[params.get('tod')] ? params.get('tod') : 'noon');
// Default to a hazy day so the Haze integration is visible right away; ?aqi=0 for clear sky.
const qAqi = params.get('aqi');
setAqi([0, 100, 150, 200].includes(Number(qAqi)) && qAqi !== null ? Number(qAqi) : 150);

// ---------- Loop ----------
const clock = new THREE.Clock();
const camOffset = new THREE.Vector3(0, 4.5, 9);
const camTarget = new THREE.Vector3();
let distance = 0, steps = 0, phase = 0, lastMode = '', inhaled = 0;
const pmEl = $('pm');
camera.position.copy(player.position).add(camOffset);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  // Input -> world direction (camera looks toward -z, so W = -z).
  let ix = joyVec.x, iz = joyVec.y;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  const mag = Math.min(Math.hypot(ix, iz), 1);
  const running = runToggle || keys.has('ShiftLeft') || keys.has('ShiftRight');
  const mode = running ? 'Run' : 'Walk';
  if (mode !== lastMode) { modeEl.textContent = mode; modeEl.classList.toggle('run', running); lastMode = mode; }

  if (mag > 0.05) {
    const speed = (running ? 7 : 2.8) * mag;
    const dirX = ix / Math.hypot(ix, iz), dirZ = iz / Math.hypot(ix, iz);
    const prev = player.position.clone();
    let nx = prev.x + dirX * speed * dt, nz = prev.z + dirZ * speed * dt;
    nx = THREE.MathUtils.clamp(nx, -PARK, PARK);
    nz = THREE.MathUtils.clamp(nz, -PARK, PARK);
    const inLake = ((nx - LAKE.x) / LAKE.rx) ** 2 + ((nz - LAKE.z) / LAKE.rz) ** 2 < 1;
    if (!inLake) player.position.set(nx, 0, nz);
    const moved = player.position.distanceTo(prev);
    distance += moved;
    steps += moved / (running ? 1.1 : 0.75);

    const targetYaw = Math.atan2(dirX, dirZ);
    let d = targetYaw - player.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    player.rotation.y += d * Math.min(1, dt * 10);

    phase += dt * (running ? 13 : 8) * mag;
    const swing = Math.sin(phase) * (running ? 0.9 : 0.55);
    legL.rotation.x = swing; legR.rotation.x = -swing;
    armL.rotation.x = -swing; armR.rotation.x = swing;
    player.position.y = Math.abs(Math.sin(phase)) * (running ? 0.12 : 0.05);
  } else {
    for (const l of [legL, legR, armL, armR]) l.rotation.x *= 0.85;
    player.position.y *= 0.85;
  }

  // Inhaled PM2.5 via the Haze dose model (lib/dose.js). Demo runs 60x real time so numbers move.
  const act = getActivity(mag > 0.05 ? (running ? 'run' : 'walk') : 'rest');
  if (aqi) {
    inhaled += inhaledDoseUg(PM25[aqi], act.litresPerMinute, dt /* 1 real s = 1 simulated min */);
    pmEl.textContent = formatDose(inhaled);
    $('cigs').textContent = formatCigarettes(cigaretteEquivalent(inhaled));
    $('breath').textContent = `${act.label} · ${act.litresPerMinute} L/min`;
    // Lungs/heart "breathe" faster when moving.
    const pulse = 1 + 0.04 * Math.sin(clock.elapsedTime * act.breathsPerMinute / 60 * Math.PI * 2);
    organs.style.setProperty('--pulse', pulse.toFixed(3));
  }

  // Haze drifts with the walker.
  haze.position.set(player.position.x, 0, player.position.z);
  haze.rotation.y += dt * 0.03;

  distEl.textContent = (distance / 1000).toFixed(2);
  stepsEl.textContent = String(Math.floor(steps));

  // Follow camera + shadow-casting sun that tracks the player.
  camera.position.lerp(camTarget.copy(player.position).add(camOffset), 1 - Math.exp(-dt * 5));
  camera.lookAt(player.position.x, player.position.y + 1.6, player.position.z - 4);
  sun.position.copy(player.position).add(sunOffset);
  sun.target.position.copy(player.position);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
