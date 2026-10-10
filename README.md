# KLSCM 2026 · Haze Edition (local replica)

Offline replica of https://klscm-haze.vercel.app/ — a Three.js 3D marathon-route visualisation of Kuala Lumpur under haze (AQI 100/150/200 + sunny modes, lungs/heart exposure overlay).

## Run

```sh
python3 -m http.server 4173
```

Open http://localhost:4173 (must be served from the site root; asset paths are root-absolute).

## Layout

- `index.html` – original markup + inline CSS
- `assets/index-BEj8RI2h.js` – original Vite/Three.js bundle
- `route.json`, `osm-start.json`, `osm-klcc.json` – route + OpenStreetMap building data
- `models/*.glb` – runner and tree models
- `heart/`, `lungs/` – organ render images
