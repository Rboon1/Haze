# Project: KLCC Park Walk
Static three.js page: a person walking/running in KLCC Park with the twin towers behind, keyboard and touch controls, time-of-day presets, distance/steps HUD.

Stack: index.html + style.css + main.js (ES modules, no build step), three.js r169 vendored at ./vendor/three via importmap, all geometry procedural. Served with `make run` (python3 http.server on 127.0.0.1:4173).
