export interface Joystick {
  readonly element: HTMLElement;
  dispose(): void;
}

/**
 * On-screen joystick for touch or mouse. Reports x (right) and y (down) in -1..1.
 * It is a convenience: keyboard movement works without it, so it is hidden from assistive tech.
 */
export function createJoystick(parent: HTMLElement, onChange: (x: number, y: number) => void): Joystick {
  const base = document.createElement('div');
  base.className = 'joy';
  base.setAttribute('aria-hidden', 'true');
  const knob = document.createElement('div');
  knob.className = 'knob';
  base.appendChild(knob);
  parent.appendChild(base);

  let pointerId: number | null = null;

  const move = (event: PointerEvent): void => {
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = event.clientX - (rect.left + radius);
    let dy = event.clientY - (rect.top + radius);
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx *= radius / length;
      dy *= radius / length;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onChange(dx / radius, dy / radius);
  };
  const end = (): void => {
    pointerId = null;
    knob.style.transform = '';
    onChange(0, 0);
  };
  const down = (event: PointerEvent): void => {
    pointerId = event.pointerId;
    base.setPointerCapture(pointerId);
    move(event);
  };
  const moveIfActive = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) move(event);
  };

  base.addEventListener('pointerdown', down);
  base.addEventListener('pointermove', moveIfActive);
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);

  return {
    element: base,
    dispose() {
      base.removeEventListener('pointerdown', down);
      base.removeEventListener('pointermove', moveIfActive);
      base.removeEventListener('pointerup', end);
      base.removeEventListener('pointercancel', end);
      base.remove();
    },
  };
}
