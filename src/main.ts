import './style.css';
import { LungScene } from './scene/lungs';
import { AirQualityError, fetchAirQuality, type AirQuality } from './lib/aq';
import {
  ACTIVITIES, activityForPace, cigaretteEquivalent, cigarettesPerDayAtRest, getActivity, inhaledDoseUg,
  type ActivityId,
} from './lib/dose';
import { formatAge, formatCigarettes, formatDose, formatDuration, formatLocalTime, formatPace } from './lib/format';
import { GeoError, getBrowserLocation, locationPermissionGranted, searchPlaces } from './lib/geo';
import { categoryForAqi, mainPollutant, POLLUTANT_LABELS, severityForAqi } from './lib/health';
import { DEFAULT_PLACE, KLCC_TRACK, PRESET_PLACES, samePlace, type Place } from './lib/places';
import { bestWindow, recommend } from './lib/recommend';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const SHORT_LABELS = {
  good: 'Good',
  moderate: 'Moderate',
  sensitive: 'Sensitive groups',
  unhealthy: 'Unhealthy',
  'very-unhealthy': 'Very unhealthy',
  hazardous: 'Hazardous',
} as const;

function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

type Result = { aq: AirQuality } | { error: string };

function errorText(error: unknown): string {
  if (error instanceof AirQualityError) return error.message;
  return 'Something went wrong while loading air quality.';
}

const state = {
  place: DEFAULT_PLACE as Place,
  selected: null as Result | null,
  route: null as Result | null,
  compare: new Map<string, Result>(),
  activity: 'jog' as ActivityId,
  minutes: 30,
  laps: 1,
  pace: 6.5,
};

let selectedAbort: AbortController | null = null;

// ---------- 3D scene ----------
const scene = new LungScene($('scene'), { severity: 0, pm25: 0, activity: getActivity(state.activity) });

function updateScene(): void {
  const activity = getActivity(state.activity);
  if (state.selected && 'aq' in state.selected) {
    const { aq } = state.selected;
    const category = categoryForAqi(aq.usAqi);
    scene.update({ severity: severityForAqi(aq.usAqi), pm25: aq.pm25, activity });
    $('condition-label').textContent = category.lungs;
    $('day-cig').textContent = formatCigarettes(cigarettesPerDayAtRest(aq.pm25));
    $('scene-desc').textContent =
      `Lungs look ${category.lungs.toLowerCase()} for ${state.place.name}. Air quality is ${category.label} ` +
      `with PM2.5 of ${aq.pm25.toFixed(0)} micrograms per cubic metre, while ${activity.label.toLowerCase()}.`;
  } else {
    scene.update({ severity: 0, pm25: 0, activity });
    $('condition-label').textContent = state.selected ? 'No data' : 'Loading…';
    $('day-cig').textContent = '--';
    $('scene-desc').textContent = 'No air quality data is available, so the lungs are shown without a condition.';
  }
}

// ---------- Air quality panel ----------
function renderAir(): void {
  const message = $('aq-message');
  const body = $('aq-body');
  $('place-name').textContent = state.place.name;
  if (!state.selected) {
    message.hidden = false;
    message.className = 'message info';
    message.textContent = 'Loading air quality…';
    body.hidden = true;
    return;
  }
  if ('error' in state.selected) {
    message.hidden = false;
    message.className = 'message';
    message.textContent = `Air quality is unavailable for ${state.place.name}. ${state.selected.error}`;
    body.hidden = true;
    return;
  }
  const { aq } = state.selected;
  const category = categoryForAqi(aq.usAqi);
  message.hidden = true;
  body.hidden = false;
  const number = $('aqi-number');
  number.textContent = String(Math.round(aq.usAqi));
  number.style.background = category.color;
  number.style.color = category.textColor;
  $('aqi-category').textContent = category.label;
  $('aqi-summary').textContent = category.summary;
  const main = mainPollutant(aq.subIndices);
  $('main-pollutant').textContent = main ? POLLUTANT_LABELS[main] : 'Not available';
  $('pm25-now').textContent = `${aq.pm25.toFixed(1)} \u00b5g/m\u00b3`;
  $('pm10-now').textContent = aq.pm10 === null ? 'Not available' : `${aq.pm10.toFixed(1)} \u00b5g/m\u00b3`;
  const grid = Number.isFinite(aq.gridLat)
    ? ` Grid point ${aq.gridLat.toFixed(2)}\u00b0, ${aq.gridLon.toFixed(2)}\u00b0.`
    : '';
  $('aq-source').textContent =
    `Updated ${formatLocalTime(aq.observedAt, aq.utcOffsetSeconds)}, ${formatAge(aq.observedAt, Date.now())}. ` +
    `Source: Open-Meteo CAMS model, not a monitoring station.${grid}`;
}

// ---------- Breathing panel ----------
function renderBreath(): void {
  const activity = getActivity(state.activity);
  $('minutes-label').textContent = `${state.minutes} min`;
  $('facts-breath').textContent = `${activity.litresPerMinute} L/min, ~${activity.breathsPerMinute} breaths/min`;
  const bars = $('activity-bars');
  bars.replaceChildren();

  if (!state.selected || 'error' in state.selected) {
    $('facts-dose').textContent = 'No data';
    $('facts-cig').textContent = 'No data';
    return;
  }
  const { pm25 } = state.selected.aq;
  const dose = inhaledDoseUg(pm25, activity.litresPerMinute, state.minutes);
  $('facts-dose').textContent = `${formatDose(dose)} \u00b5g`;
  $('facts-cig').textContent = `\u2248 ${formatCigarettes(cigaretteEquivalent(dose))}`;

  const perHour = ACTIVITIES.map((a) => ({ a, dose: inhaledDoseUg(pm25, a.litresPerMinute, 60) }));
  const max = Math.max(...perHour.map((p) => p.dose), 0.0001);
  for (const { a, dose: d } of perHour) {
    const row = el('div', undefined, `bar-row${a.id === state.activity ? ' active' : ''}`);
    row.appendChild(el('span', a.label, 'bar-name'));
    const track = el('div', undefined, 'bar-track');
    const fill = el('div', undefined, 'bar-fill');
    fill.style.width = `${Math.max(2, (d / max) * 100)}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', `${formatDose(d)} \u00b5g`));
    bars.appendChild(row);
  }
}

function buildActivityOptions(): void {
  const container = $('activity-options');
  for (const a of ACTIVITIES) {
    const label = el('label', undefined, 'seg');
    const input = el('input');
    input.type = 'radio';
    input.name = 'activity';
    input.value = a.id;
    input.checked = a.id === state.activity;
    input.addEventListener('change', () => {
      state.activity = a.id;
      renderBreath();
      renderCompare();
      updateScene();
    });
    label.appendChild(input);
    label.appendChild(el('span', a.label));
    container.appendChild(label);
  }
}

// ---------- Compare panel ----------
function renderCompare(): void {
  const host = $('compare-table');
  host.replaceChildren();
  const activity = getActivity(state.activity);

  interface Row { name: string; result: Result | undefined; selected: boolean }
  const rows: Row[] = PRESET_PLACES.map((p) => ({
    name: p.name,
    result: state.compare.get(p.name),
    selected: samePlace(p, state.place),
  }));
  if (!PRESET_PLACES.some((p) => samePlace(p, state.place)) && state.selected) {
    rows.push({ name: state.place.name, result: state.selected, selected: true });
  }
  const pm = (r: Row): number => (r.result && 'aq' in r.result ? r.result.aq.pm25 : Infinity);
  rows.sort((a, b) => pm(a) - pm(b));
  const best = rows.find((r) => Number.isFinite(pm(r)));

  const table = el('table');
  const caption = el('caption', 'Locations ranked by current PM2.5, cleanest first', 'sr-only');
  table.appendChild(caption);
  const head = el('tr');
  $('cmp-note').textContent =
    `Dose = PM2.5 breathed in during ${state.minutes} min of ${activity.label.toLowerCase()}. PM2.5 is the current hourly value, ranked cleanest first.`;
  for (const h of ['Place', 'PM2.5', 'US AQI', 'Dose', 'Cigs']) {
    const th = el('th', h);
    th.scope = 'col';
    head.appendChild(th);
  }
  const thead = el('thead');
  thead.appendChild(head);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    if (row === best) tr.className = 'best';
    const th = el('th', row.name + (row.selected ? ' (selected)' : ''));
    th.scope = 'row';
    tr.appendChild(th);
    if (row.result && 'aq' in row.result) {
      const { aq } = row.result;
      const dose = inhaledDoseUg(aq.pm25, activity.litresPerMinute, state.minutes);
      tr.appendChild(el('td', `${aq.pm25.toFixed(1)}`));
      const cat = categoryForAqi(aq.usAqi);
      tr.appendChild(el('td', `${Math.round(aq.usAqi)} ${SHORT_LABELS[cat.id]}`));
      tr.appendChild(el('td', `${formatDose(dose)} \u00b5g`));
      tr.appendChild(el('td', `\u2248 ${formatCigarettes(cigaretteEquivalent(dose))}`));
    } else {
      const td = el('td', row.result ? 'Unavailable' : 'Loading…');
      td.colSpan = 4;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);
}

// ---------- Route panel ----------
function renderRoute(): void {
  const message = $('route-message');
  const body = $('route-body');
  const distanceKm = KLCC_TRACK.lapKm * state.laps;
  $('route-meta').textContent = `${KLCC_TRACK.name}, ${KLCC_TRACK.city}. About ${KLCC_TRACK.lapKm} km per lap (approximate).`;
  const sources = $('route-sources');
  sources.replaceChildren(document.createTextNode('Lap length sources: '));
  KLCC_TRACK.sources.forEach((s, i) => {
    const a = el('a', s.label);
    a.href = s.url;
    a.rel = 'noopener';
    sources.appendChild(a);
    if (i < KLCC_TRACK.sources.length - 1) sources.appendChild(document.createTextNode(', '));
  });

  if (!Number.isFinite(state.pace) || state.pace < 3 || state.pace > 15) {
    message.hidden = false;
    message.className = 'message';
    message.textContent = 'Enter a pace between 3 and 15 minutes per km.';
    body.hidden = true;
    return;
  }
  if (!state.route) {
    message.hidden = false;
    message.className = 'message info';
    message.textContent = 'Loading air quality for the track…';
    body.hidden = true;
    return;
  }
  if ('error' in state.route) {
    message.hidden = false;
    message.className = 'message';
    message.textContent = `No recommendation: air quality for the track is unavailable. ${state.route.error}`;
    body.hidden = true;
    return;
  }

  const { aq } = state.route;
  const minutes = distanceKm * state.pace;
  const activity = getActivity(activityForPace(state.pace));
  const dose = inhaledDoseUg(aq.pm25, activity.litresPerMinute, minutes);
  const rec = recommend(aq.pm25, aq.usAqi);
  message.hidden = true;
  body.hidden = false;

  const verdict = $('route-verdict');
  verdict.className = `verdict ${rec.verdict}`;
  verdict.textContent = { go: 'GO', caution: 'CAUTION', avoid: 'AVOID' }[rec.verdict];
  const reasons = $('route-reasons');
  reasons.replaceChildren(...rec.reasons.map((r) => el('li', r)));
  $('route-distance').textContent = `${distanceKm.toFixed(1)} km (${state.laps} ${state.laps === 1 ? 'lap' : 'laps'})`;
  $('route-time').textContent = `${formatDuration(minutes)} at ${formatPace(state.pace)}`;
  $('route-level').textContent = `${activity.label} (${activity.litresPerMinute} L/min)`;
  $('route-dose').textContent = `${formatDose(dose)} \u00b5g`;
  $('route-cig').textContent = `\u2248 ${formatCigarettes(cigaretteEquivalent(dose))}`;

  const windowText = $('route-window');
  const win = rec.verdict === 'go' ? null : bestWindow(aq.forecast, aq.pm25, Date.now());
  windowText.textContent = win
    ? `Cleaner air is forecast around ${formatLocalTime(win.epoch, aq.utcOffsetSeconds)} (PM2.5 about ${win.pm25.toFixed(0)} \u00b5g/m\u00b3 vs ${aq.pm25.toFixed(0)} now).`
    : rec.verdict === 'go'
      ? ''
      : 'No clearly cleaner window is forecast in the next 24 hours.';
}

// ---------- Data loading ----------
async function loadResult(lat: number, lon: number, signal?: AbortSignal): Promise<Result> {
  try {
    return { aq: await fetchAirQuality(lat, lon, signal ? { signal } : {}) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { error: errorText(error) };
  }
}

async function loadSelected(): Promise<void> {
  selectedAbort?.abort();
  const controller = new AbortController();
  selectedAbort = controller;
  state.selected = null;
  renderAir();
  updateScene();
  try {
    const result = await loadResult(state.place.lat, state.place.lon, controller.signal);
    if (controller.signal.aborted) return;
    state.selected = result;
  } catch {
    return; // superseded by a newer request
  }
  renderAir();
  renderBreath();
  renderCompare();
  updateScene();
}

async function loadRoute(): Promise<void> {
  state.route = await loadResult(KLCC_TRACK.lat, KLCC_TRACK.lon);
  renderRoute();
}

async function loadCompare(): Promise<void> {
  await Promise.all(
    PRESET_PLACES.map(async (place) => {
      state.compare.set(place.name, await loadResult(place.lat, place.lon));
      renderCompare();
    }),
  );
}

async function refreshAll(): Promise<void> {
  const button = $<HTMLButtonElement>('btn-refresh');
  button.disabled = true;
  await Promise.all([loadSelected(), loadRoute(), loadCompare()]);
  button.disabled = false;
}

function selectPlace(place: Place): void {
  state.place = place;
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  void loadSelected();
}

// ---------- Location + search ----------
async function useMyLocation(): Promise<void> {
  const status = $('search-status');
  const button = $<HTMLButtonElement>('btn-locate');
  button.disabled = true;
  status.textContent = 'Finding your location…';
  try {
    const { lat, lon } = await getBrowserLocation();
    status.textContent = '';
    selectPlace({ name: `Your location (${lat.toFixed(2)}, ${lon.toFixed(2)})`, lat, lon });
  } catch (error) {
    status.textContent = error instanceof GeoError ? error.message : 'Could not determine your location.';
  } finally {
    button.disabled = false;
  }
}

async function runSearch(event: Event): Promise<void> {
  event.preventDefault();
  const status = $('search-status');
  const list = $('search-results');
  list.replaceChildren();
  status.textContent = 'Searching…';
  try {
    const places = await searchPlaces($<HTMLInputElement>('search-input').value);
    if (places.length === 0) {
      status.textContent = 'No matching places in Malaysia. Try another spelling.';
      return;
    }
    status.textContent = `${places.length} result${places.length === 1 ? '' : 's'}:`;
    for (const place of places) {
      const item = el('li');
      const button = el('button', place.name);
      button.type = 'button';
      button.addEventListener('click', () => selectPlace(place));
      item.appendChild(button);
      list.appendChild(item);
    }
  } catch (error) {
    status.textContent = error instanceof GeoError ? error.message : 'Search failed. Please try again.';
  }
}

function buildPresetChips(): void {
  const host = $('preset-chips');
  for (const place of PRESET_PLACES) {
    const chip = el('button', place.name, 'chip');
    chip.type = 'button';
    chip.addEventListener('click', () => selectPlace(place));
    host.appendChild(chip);
  }
}

// ---------- Wiring ----------
buildActivityOptions();
buildPresetChips();

$('btn-locate').addEventListener('click', () => void useMyLocation());
$('btn-refresh').addEventListener('click', () => void refreshAll());
$('search-form').addEventListener('submit', (e) => void runSearch(e));
$<HTMLInputElement>('minutes').addEventListener('input', (e) => {
  state.minutes = Number((e.target as HTMLInputElement).value);
  renderBreath();
  renderCompare();
});
$<HTMLSelectElement>('laps').addEventListener('change', (e) => {
  state.laps = Number((e.target as HTMLSelectElement).value);
  renderRoute();
});
$<HTMLInputElement>('pace').addEventListener('input', (e) => {
  state.pace = Number((e.target as HTMLInputElement).value);
  renderRoute();
});

renderAir();
renderBreath();
renderCompare();
renderRoute();
void refreshAll();
setInterval(() => void refreshAll(), REFRESH_INTERVAL_MS);

// Use the browser location automatically only if the user already granted permission earlier.
void locationPermissionGranted().then((granted) => {
  if (granted) void useMyLocation();
});
