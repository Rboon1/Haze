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
src/lib/      aq (fetch + validation), dose, health, recommend, geo, places, format
src/scene/    lungs.ts (three.js scene)
src/main.ts   UI wiring
tests/        unit tests for the logic above
```

## Known limits

- One track only. Lap length is from several public sources and is approximate.
- Track air quality uses a ~10 km grid cell, so it is effectively "central KL".
- Not yet verified: screen-reader behaviour and full WCAG conformance (needs manual testing with assistive technology), and behaviour on real mobile devices.
