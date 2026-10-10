# KLCC Park Walk

A static three.js page: walk or run through KLCC Park with the Petronas Twin Towers behind you, with switchable time of day.

## Run

```sh
make run
```

Serves the folder with `python3 -m http.server` on http://127.0.0.1:4173 and opens the browser. Must be served over HTTP (ES modules + importmap), not opened via `file://`.

## Controls

- Desktop: WASD / arrow keys to move, hold Shift to run
- Mobile: on-screen joystick to move, Run button to run
- Time of day: Morning / Noon / Sunset / Night buttons
- HUD shows distance walked and step count

## Layout

- `index.html` – page markup, HUD, importmap for three.js
- `style.css` – HUD, buttons, joystick styles
- `main.js` – procedural scene (park, towers, walker), input, lighting presets
- `vendor/three/` – three.js r169 (`build/three.module.js`)
- `Makefile` – `make run` target
