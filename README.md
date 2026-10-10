# Haze & Your Lungs (prototype)

Educational prototype: live air quality for a chosen place, a 3D human whose lungs react to it, a comparison of breathing levels and locations, and a go / caution / avoid check for **one** running track (KLCC Park, ~1.3 km per lap).

**Not medical advice.** Figures are rough estimates.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # unit tests (vitest)
npm run typecheck
npm run build
```

No API key or backend is needed. Air quality comes from the [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) (CC BY 4.0, free for non-commercial use).

## Park walk (interactive 3D)

The **Park walk** tab next to **Lungs** is an interactive stylised KLCC Park with the Petronas Twin Towers behind you. It was ported from Louis's `klcc-park-walk` demo (branches `develop` / `klcc-park-walk`) into this app as TypeScript.

- **Controls:** W A S D or arrow keys to walk, hold Shift (or the Run button) to run. Keys only work while the scene has focus, so typing in the search box never moves the walker. On touch screens there is an on-screen joystick.
- **Live haze:** fog, drifting dust and the organ images follow the selected place's live US AQI. If air quality is unavailable the park shows clear sky and no dose, never a made-up value.
- **Dose while you move:** PM2.5 breathed in uses the same zone model as the rest of the app: idle is Rest, walking is Walk, and running uses the effort zone from "Your plan". The demo counts **1 real second as 1 simulated minute** so the numbers visibly move.
- **Time of day:** morning, noon, sunset, night.
- **Not to scale:** distances are stylised world units. The scene is procedural and uses no external 3D assets. It loads only when you open the tab.
- **Organ images:** `public/organs/*.jpg` are Blender renders from Louis's branch, shown as illustrations for roughly AQI 100, 150 and 200. They are not scans of your body. Confirm you have the right to use them before publishing the site.

## What it does and does not do

- **Data is modelled, not a station reading.** Open-Meteo returns CAMS model values on a grid. It is not Malaysia's DOE API/IPU feed and can differ from it. The UI says so. Readings older than 3 hours are shown as unavailable, never as stale numbers.
- **Scale:** US AQI categories. Particulate AQI is a 24-hour average; "PM2.5 now" is the current hourly value and drives the dose.
- **Dose** = PM2.5 (µg/m³) x breathing rate x time. Breathing rates are assumed adult ballparks (resting 7.5, walking 20, jogging 40, running 60 L/min). It is air breathed in, not lung deposition.
- **Cigarette equivalent:** rule of thumb of ~22 µg/m³ over 24 h = 1 cigarette, pinned to resting breathing (~238 µg per cigarette). Rough only.
- **Run verdict:** go at PM2.5 <= 15 (WHO 24 h guideline), caution <= 35 (US EPA 24 h standard), avoid above; raised one level when the 24 h US AQI >= 151.
- **3D model:** procedural and stylised, not anatomically exact.
- **Privacy:** location is used in the browser and sent to Open-Meteo only to fetch air quality. Nothing is stored.

## Layout

```
src/lib/      aq (fetch + validation), dose, health, recommend, geo, places, spots, plan, walk, format
src/scene/    lungs.ts (3D lungs), park.ts (interactive park walk, lazy-loaded)
src/ui/       dom helpers, Leaflet map, on-screen joystick
src/main.ts   UI wiring
public/organs illustrative organ renders for the park walk
tests/        unit tests for the logic above
```

## Known limits

- One track only. Lap length is from several public sources and is approximate.
- Track air quality uses a ~10 km grid cell, so it is effectively "central KL".
- Not yet verified: screen-reader behaviour and full WCAG conformance (needs manual testing with assistive technology), and behaviour on real mobile devices.
