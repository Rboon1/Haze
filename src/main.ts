import './style.css';
import { LungScene } from './scene/lungs';
import { SpotMap, type MapMarker } from './ui/map';
import { $, el } from './ui/dom';
import { AirQualityError, fetchAirQuality, fetchAirQualityBatch, type AirQuality } from './lib/aq';
import {
  ACTIVITIES, activityForPace, cigaretteEquivalent, cigarettesPerDayAtRest, getActivity, inhaledDoseUg,
  retainedDoseUg, sittingHoursEquivalent, zoneBpm, type Activity,
} from './lib/dose';
import {
  formatAge, formatCigarettes, formatDose, formatDuration, formatHoursEquivalent, formatLocalTime,
} from './lib/format';
import { GeoError, getBrowserLocation, locationPermissionGranted, searchPlaces } from './lib/geo';
import { categoryForAqi, mainPollutant, POLLUTANT_LABELS, severityForAqi } from './lib/health';
import type { Place } from './lib/places';
import { AGE_RANGE, MINUTES_RANGE, loadPlan, sanitizePlan, savePlan, type Plan } from './lib/plan';
import { bestWindow, recommend } from './lib/recommend';
import { DEFAULT_SPOT_ID, SPOTS, getSpot, spotStates, type Spot } from './lib/spots';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const DISTANCE_RANGE = [0.5, 42] as const;
const PACE_RANGE = [3, 15] as const;
const NO_DATA_COLOR = { color: '#9ca3af', textColor: '#111827' } as const;

type Result = { aq: AirQuality } | { error: string };
type Selection = { kind: 'spot'; id: string } | { kind: 'place'; place: Place };

const state = {
  plan: loadPlan() as Plan,
  selection: { kind: 'spot', id: DEFAULT_SPOT_ID } as Selection,
  stateFilter: 'All',
  spots: new Map<string, Result>(),
  spotsLoading: true,
  custom: null as Result | null,
  distanceKm: getSpot(DEFAULT_SPOT_ID)?.distanceKm ?? 1.3,
  pace: 6.5,
};

let customAbort: AbortController | null = null;

function errorText(error: unknown): string {
  return error instanceof AirQualityError ? error.message : 'Something went wrong while loading air quality.';
}

// ---------- Selection helpers ----------
function selectedSpot(): Spot | undefined {
  return state.selection.kind === 'spot' ? getSpot(state.selection.id) : undefined;
}
function selectedName(): string {
  return state.selection.kind === 'spot' ? (selectedSpot()?.name ?? 'Unknown spot') : state.selection.place.name;
}
function selectedResult(): Result | null {
  return state.selection.kind === 'spot' ? (state.spots.get(state.selection.id) ?? null) : state.custom;
}
function planActivity(): Activity {
  return getActivity(state.plan.activity);
}

function doseFor(activity: Activity, minutes: number, pm25: number) {
  const inhaled = inhaledDoseUg(pm25, activity.litresPerMinute, minutes);
  return {
    inhaled,
    retained: retainedDoseUg(inhaled, activity),
    cigarettes: cigaretteEquivalent(inhaled),
    sittingHours: sittingHoursEquivalent(activity, minutes),
  };
}

// ---------- 3D scene and map ----------
const scene = new LungScene($('scene'), { severity: 0, pm25: 0, activity: planActivity() });
const map = new SpotMap($('map'), (id) => selectSpot(id));

function updateScene(): void {
  const activity = planActivity();
  const result = selectedResult();
  if (result && 'aq' in result) {
    const { aq } = result;
    const category = categoryForAqi(aq.usAqi);
    scene.update({ severity: severityForAqi(aq.usAqi), pm25: aq.pm25, activity });
    $('condition-label').textContent = category.lungs;
    $('day-cig').textContent = formatCigarettes(cigarettesPerDayAtRest(aq.pm25));
    $('scene-desc').textContent =
      `Lungs look ${category.lungs.toLowerCase()} for ${selectedName()}. Air quality is ${category.label} ` +
      `with PM2.5 of ${aq.pm25.toFixed(0)} micrograms per cubic metre, breathing at ${activity.label.toLowerCase()}.`;
  } else {
    scene.update({ severity: 0, pm25: 0, activity });
    $('condition-label').textContent = result ? 'No data' : 'Loading…';
    $('day-cig').textContent = '--';
    $('scene-desc').textContent = 'No air quality data is available, so the lungs are shown without a condition.';
  }
}

// ---------- Air quality panel ----------
function renderAir(): void {
  const message = $('aq-message');
  const body = $('aq-body');
  const result = selectedResult();
  $('place-name').textContent = selectedName();
  if (!result) {
    message.hidden = false;
    message.className = 'message info';
    message.textContent = 'Loading air quality…';
    body.hidden = true;
    return;
  }
  if ('error' in result) {
    message.hidden = false;
    message.className = 'message';
    message.textContent = `Air quality is unavailable for ${selectedName()}. ${result.error}`;
    body.hidden = true;
    return;
  }
  const { aq } = result;
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
  const grid = Number.isFinite(aq.gridLat) ? ` Grid point ${aq.gridLat.toFixed(2)}\u00b0, ${aq.gridLon.toFixed(2)}\u00b0.` : '';
  $('aq-source').textContent =
    `Updated ${formatLocalTime(aq.observedAt, aq.utcOffsetSeconds)}, ${formatAge(aq.observedAt, Date.now())}. ` +
    `Source: Open-Meteo CAMS model, not a monitoring station.${grid}`;
}

// ---------- Plan panel ----------
function updatePlan(patch: Partial<Plan>): void {
  state.plan = sanitizePlan({ ...state.plan, ...patch });
  savePlan(state.plan);
  renderAll();
}

function buildEffortOptions(): void {
  const container = $('effort-options');
  for (const a of ACTIVITIES) {
    const label = el('label', undefined, 'seg');
    const input = el('input');
    input.type = 'radio';
    input.name = 'effort';
    input.value = a.id;
    input.addEventListener('change', () => updatePlan({ activity: a.id }));
    label.appendChild(input);
    label.appendChild(el('span', a.shortLabel));
    container.appendChild(label);
  }
}

function renderPlan(): void {
  const { plan } = state;
  const activity = planActivity();
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="effort"]')) {
    input.checked = input.value === plan.activity;
  }
  $('minutes-label').textContent = `${plan.minutes} min`;
  $<HTMLInputElement>('minutes').value = String(plan.minutes);
  const ageInput = $<HTMLInputElement>('age');
  if (document.activeElement !== ageInput) ageInput.value = String(plan.age);
  $<HTMLInputElement>('sensitive').checked = plan.sensitive;

  const bpm = zoneBpm(activity, plan.age);
  $('effort-desc').textContent = `${activity.label}: ${activity.feel}.`;
  $('facts-hr').textContent = bpm ? `${bpm[0]}\u2013${bpm[1]} bpm` : 'n/a';
  $('facts-air').textContent = `${activity.litresPerMinute} L/min`;
  $('facts-mode').textContent = activity.breathing;

  const bars = $('activity-bars');
  bars.replaceChildren();
  const result = selectedResult();
  if (!result || 'error' in result) {
    for (const id of ['facts-dose', 'facts-retained', 'facts-cig']) $(id).textContent = 'No data';
    $('facts-sitting').textContent = '';
    return;
  }
  const { pm25 } = result.aq;
  const dose = doseFor(activity, plan.minutes, pm25);
  $('facts-dose').textContent = `${formatDose(dose.inhaled)} \u00b5g`;
  $('facts-retained').textContent = `~${formatDose(dose.retained)} \u00b5g`;
  $('facts-cig').textContent = `\u2248 ${formatCigarettes(dose.cigarettes)}`;
  $('facts-sitting').textContent =
    `About as much in the lungs as sitting outside for ${formatHoursEquivalent(dose.sittingHours)} in the same air.`;

  const perHour = ACTIVITIES.map((a) => ({ a, ...doseFor(a, 60, pm25) }));
  const max = Math.max(...perHour.map((p) => p.inhaled), 0.0001);
  for (const row of perHour) {
    const line = el('div', undefined, `bar-row${row.a.id === plan.activity ? ' active' : ''}`);
    line.appendChild(el('span', row.a.shortLabel, 'bar-name'));
    const track = el('div', undefined, 'bar-track');
    const fill = el('div', undefined, 'bar-fill');
    fill.style.width = `${Math.max(2, (row.inhaled / max) * 100)}%`;
    track.appendChild(fill);
    line.appendChild(track);
    line.appendChild(el('span', `${formatDose(row.inhaled)} \u2192 ${formatDose(row.retained)} \u00b5g`));
    bars.appendChild(line);
  }
}

// ---------- Spots list + map ----------
function visibleSpots(): Spot[] {
  const key = (s: Spot): [number, number] => {
    const r = state.spots.get(s.id);
    return r && 'aq' in r ? [r.aq.usAqi, r.aq.pm25] : [Infinity, Infinity];
  };
  return SPOTS.filter((s) => state.stateFilter === 'All' || s.state === state.stateFilter).sort((a, b) => {
    const [aa, ap] = key(a);
    const [ba, bp] = key(b);
    return aa === ba ? ap - bp : aa - ba;
  });
}

function distanceLabel(spot: Spot): string {
  return spot.basis === 'sourced' ? `${spot.distanceKm} km` : `~${spot.distanceKm} km (typical)`;
}

function spotDetails(spot: Spot, result: Result | undefined): HTMLElement {
  const box = el('div', undefined, 'spot-details');
  box.id = `spot-details-${spot.id}`;
  const facts = el('ul', undefined, 'detail-list');
  const distance = el('li');
  distance.appendChild(document.createTextNode(`${spot.surface} · ${spot.distanceKm} km. `));
  if (spot.basis === 'sourced' && spot.sources) {
    distance.appendChild(document.createTextNode('Distance sourced: '));
    spot.sources.forEach((s, i) => {
      const a = el('a', s.label);
      a.href = s.url;
      a.rel = 'noopener';
      distance.appendChild(a);
      if (i < (spot.sources?.length ?? 0) - 1) distance.appendChild(document.createTextNode(', '));
    });
  } else {
    distance.appendChild(document.createTextNode('Typical length, unverified.'));
  }
  facts.appendChild(distance);

  if (result && 'aq' in result) {
    const { aq } = result;
    const activity = planActivity();
    const dose = doseFor(activity, state.plan.minutes, aq.pm25);
    const rec = recommend({ pm25: aq.pm25, usAqi: aq.usAqi, activity, sensitive: state.plan.sensitive });
    facts.appendChild(el('li', `PM2.5 ${aq.pm25.toFixed(1)} \u00b5g/m\u00b3 now. ${state.plan.minutes} min at ${activity.shortLabel}: ${formatDose(dose.inhaled)} \u00b5g in, ~${formatDose(dose.retained)} \u00b5g stays, \u2248 ${formatCigarettes(dose.cigarettes)} cigarettes.`));
    const win = rec.verdict === 'go' ? null : bestWindow(aq.forecast, aq.pm25, Date.now(), aq.utcOffsetSeconds);
    if (win) {
      facts.appendChild(el('li', `Cleaner air forecast around ${formatLocalTime(win.epoch, aq.utcOffsetSeconds)} (PM2.5 about ${win.pm25.toFixed(0)} \u00b5g/m\u00b3).`));
    }
    for (const reason of rec.reasons) facts.appendChild(el('li', reason));
  }
  box.appendChild(facts);
  return box;
}

function renderSpots(): void {
  const list = $('spot-list');
  const message = $('spots-message');
  list.replaceChildren();
  const spots = visibleSpots();
  const activity = planActivity();

  const failed = SPOTS.length > 0 && SPOTS.every((s) => {
    const r = state.spots.get(s.id);
    return r && 'error' in r;
  });
  if (state.spotsLoading && state.spots.size === 0) {
    message.hidden = false;
    message.className = 'message info';
    message.textContent = 'Loading air quality for the spots…';
  } else if (failed) {
    const first = state.spots.get(SPOTS[0]?.id ?? '');
    message.hidden = false;
    message.className = 'message';
    message.textContent = `Air quality is unavailable for the spots. ${first && 'error' in first ? first.error : ''}`;
  } else {
    message.hidden = true;
  }

  const markers: MapMarker[] = [];
  for (const spot of spots) {
    const result = state.spots.get(spot.id);
    const ok = result && 'aq' in result ? result.aq : null;
    const category = ok ? categoryForAqi(ok.usAqi) : null;
    const colors = category ?? NO_DATA_COLOR;
    const isSelected = state.selection.kind === 'spot' && state.selection.id === spot.id;
    markers.push({
      id: spot.id, name: spot.name, lat: spot.lat, lon: spot.lon,
      label: ok ? String(Math.round(ok.usAqi)) : '\u2013', color: colors.color, textColor: colors.textColor,
    });

    const item = el('li', undefined, `spot${isSelected ? ' selected' : ''}`);
    const button = el('button', undefined, 'spot-btn');
    button.type = 'button';
    button.setAttribute('aria-expanded', String(isSelected));
    button.setAttribute('aria-controls', `spot-details-${spot.id}`);
    button.addEventListener('click', () => selectSpot(spot.id));

    const badge = el('span', ok ? String(Math.round(ok.usAqi)) : '\u2013', 'spot-aqi');
    badge.style.background = colors.color;
    badge.style.color = colors.textColor;
    button.appendChild(badge);

    const main = el('span', undefined, 'spot-main');
    main.appendChild(el('span', spot.name, 'spot-name'));
    const sub = el('span', undefined, 'spot-sub');
    sub.appendChild(document.createTextNode(`${spot.city} · ${distanceLabel(spot)} · `));
    if (ok) {
      const rec = recommend({ pm25: ok.pm25, usAqi: ok.usAqi, activity, sensitive: state.plan.sensitive });
      sub.appendChild(el('span', rec.title, `verdict-pill ${rec.verdict}`));
    } else {
      sub.appendChild(el('span', 'Unavailable', 'verdict-pill unknown'));
    }
    main.appendChild(sub);
    button.appendChild(main);

    const doseBox = el('span', undefined, 'spot-dose');
    if (ok) {
      const dose = doseFor(activity, state.plan.minutes, ok.pm25);
      doseBox.appendChild(el('span', `${formatDose(dose.inhaled)} \u00b5g`));
      doseBox.appendChild(el('small', `\u2248 ${formatCigarettes(dose.cigarettes)} cig`));
    }
    button.appendChild(doseBox);
    item.appendChild(button);
    if (isSelected) item.appendChild(spotDetails(spot, result));
    list.appendChild(item);
  }
  map.setMarkers(markers, state.selection.kind === 'spot' ? state.selection.id : null);
}

function buildStateFilter(): void {
  const select = $<HTMLSelectElement>('state-filter');
  for (const name of ['All', ...spotStates()]) {
    const option = el('option', name === 'All' ? 'All states' : name);
    option.value = name;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    state.stateFilter = select.value;
    renderSpots();
    map.fit(visibleSpots());
  });
}

// ---------- Route estimate ----------
function renderRoute(): void {
  const message = $('route-message');
  const body = $('route-body');
  const spot = selectedSpot();
  const hide = (text: string, info = false): void => {
    message.hidden = false;
    message.className = info ? 'message info' : 'message';
    message.textContent = text;
    body.hidden = true;
  };
  if (!spot) {
    $('route-meta').textContent = '';
    hide('Pick a running spot from the list or the map to estimate a route.', true);
    return;
  }
  $('route-meta').textContent = `${spot.name}, ${spot.city}. ${spot.basis === 'sourced' ? 'Distance sourced.' : 'Distance is a typical length, unverified: adjust it if you know better.'}`;

  const [dMin, dMax] = DISTANCE_RANGE;
  const [pMin, pMax] = PACE_RANGE;
  if (!Number.isFinite(state.distanceKm) || state.distanceKm < dMin || state.distanceKm > dMax) {
    hide(`Enter a distance between ${dMin} and ${dMax} km.`);
    return;
  }
  if (!Number.isFinite(state.pace) || state.pace < pMin || state.pace > pMax) {
    hide(`Enter a pace between ${pMin} and ${pMax} minutes per km.`);
    return;
  }
  const result = selectedResult();
  if (!result) {
    hide('Loading air quality…', true);
    return;
  }
  if ('error' in result) {
    hide(`No recommendation: air quality is unavailable. ${result.error}`);
    return;
  }

  const { aq } = result;
  const minutes = state.distanceKm * state.pace;
  const activity = getActivity(activityForPace(state.pace));
  const dose = doseFor(activity, minutes, aq.pm25);
  const rec = recommend({ pm25: aq.pm25, usAqi: aq.usAqi, activity, sensitive: state.plan.sensitive });
  message.hidden = true;
  body.hidden = false;

  const verdict = $('route-verdict');
  verdict.className = `verdict ${rec.verdict}`;
  verdict.textContent = { go: 'GO', caution: 'CAUTION', avoid: 'AVOID' }[rec.verdict];
  $('route-title-text').textContent = rec.title;
  $('route-reasons').replaceChildren(...rec.reasons.map((r) => el('li', r)));
  $('route-distance').textContent = `${state.distanceKm.toFixed(1)} km`;
  $('route-time').textContent = formatDuration(minutes);
  $('route-level').textContent = `${activity.label} (${activity.litresPerMinute} L/min)`;
  $('route-dose').textContent = `${formatDose(dose.inhaled)} \u00b5g`;
  $('route-retained').textContent = `~${formatDose(dose.retained)} \u00b5g`;
  $('route-cig').textContent = `\u2248 ${formatCigarettes(dose.cigarettes)}`;

  const win = rec.verdict === 'go' ? null : bestWindow(aq.forecast, aq.pm25, Date.now(), aq.utcOffsetSeconds);
  $('route-window').textContent = win
    ? `Cleaner air is forecast around ${formatLocalTime(win.epoch, aq.utcOffsetSeconds)} (PM2.5 about ${win.pm25.toFixed(0)} \u00b5g/m\u00b3 vs ${aq.pm25.toFixed(0)} now).`
    : rec.verdict === 'go'
      ? ''
      : 'No clearly cleaner window is forecast in the next 12 hours (05:00\u201321:00).';
}

function renderAll(): void {
  renderAir();
  renderPlan();
  renderSpots();
  renderRoute();
  updateScene();
}

// ---------- Data loading ----------
async function loadSpots(): Promise<void> {
  state.spotsLoading = true;
  try {
    const results = await fetchAirQualityBatch(SPOTS.map((s) => ({ lat: s.lat, lon: s.lon })));
    SPOTS.forEach((spot, i) => {
      const r = results[i];
      state.spots.set(spot.id, r === undefined ? { error: 'No reading.' } : r instanceof AirQualityError ? { error: r.message } : { aq: r });
    });
  } catch (error) {
    const message = errorText(error);
    for (const spot of SPOTS) state.spots.set(spot.id, { error: message });
  }
  state.spotsLoading = false;
  renderAll();
}

async function loadCustom(place: Place): Promise<void> {
  customAbort?.abort();
  const controller = new AbortController();
  customAbort = controller;
  state.custom = null;
  try {
    const aq = await fetchAirQuality(place.lat, place.lon, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.custom = { aq };
  } catch (error) {
    if (controller.signal.aborted) return; // superseded by a newer selection
    state.custom = { error: errorText(error) };
  }
  renderAll();
}

async function refreshAll(): Promise<void> {
  const button = $<HTMLButtonElement>('btn-refresh');
  button.disabled = true;
  const tasks: Promise<void>[] = [loadSpots()];
  if (state.selection.kind === 'place') tasks.push(loadCustom(state.selection.place));
  await Promise.all(tasks);
  button.disabled = false;
}

// ---------- Selection ----------
function selectSpot(id: string): void {
  const spot = getSpot(id);
  if (!spot) return;
  customAbort?.abort();
  state.selection = { kind: 'spot', id };
  state.custom = null;
  state.distanceKm = spot.distanceKm;
  $<HTMLInputElement>('distance').value = String(spot.distanceKm);
  map.setCustomPlace(null);
  map.focus(spot.lat, spot.lon);
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  renderAll();
}

function selectPlace(place: Place): void {
  state.selection = { kind: 'place', place };
  state.custom = null;
  map.setCustomPlace(place);
  map.focus(place.lat, place.lon);
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  renderAll();
  void loadCustom(place);
}

async function useMyLocation(): Promise<void> {
  const status = $('search-status');
  const button = $<HTMLButtonElement>('btn-locate');
  button.disabled = true;
  status.textContent = 'Finding your location…';
  try {
    const { lat, lon } = await getBrowserLocation();
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

// ---------- Wiring ----------
buildEffortOptions();
buildStateFilter();

$('btn-locate').addEventListener('click', () => void useMyLocation());
$('btn-refresh').addEventListener('click', () => void refreshAll());
$('search-form').addEventListener('submit', (e) => void runSearch(e));

const minutesInput = $<HTMLInputElement>('minutes');
minutesInput.min = String(MINUTES_RANGE[0]);
minutesInput.max = String(MINUTES_RANGE[1]);
minutesInput.addEventListener('input', () => updatePlan({ minutes: Number(minutesInput.value) }));

const ageInput = $<HTMLInputElement>('age');
ageInput.min = String(AGE_RANGE[0]);
ageInput.max = String(AGE_RANGE[1]);
ageInput.addEventListener('input', () => {
  if (ageInput.value.trim() !== '') updatePlan({ age: Number(ageInput.value) });
});
ageInput.addEventListener('blur', () => {
  ageInput.value = String(state.plan.age);
});

$<HTMLInputElement>('sensitive').addEventListener('change', (e) => {
  updatePlan({ sensitive: (e.target as HTMLInputElement).checked });
});
$<HTMLInputElement>('distance').addEventListener('input', (e) => {
  state.distanceKm = Number((e.target as HTMLInputElement).value);
  renderRoute();
});
$<HTMLInputElement>('pace').addEventListener('input', (e) => {
  state.pace = Number((e.target as HTMLInputElement).value);
  renderRoute();
});

renderAll();
const start = getSpot(DEFAULT_SPOT_ID);
if (start) map.focus(start.lat, start.lon);
void loadSpots();
setInterval(() => void refreshAll(), REFRESH_INTERVAL_MS);

// Use the browser location automatically only if the user already granted permission earlier.
void locationPermissionGranted().then((granted) => {
  if (granted) void useMyLocation();
});
