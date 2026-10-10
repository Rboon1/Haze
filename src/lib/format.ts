export function formatPace(minutesPerKm: number): string {
  if (!Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return '--';
  const total = Math.round(minutesPerKm * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '--';
  const totalSeconds = Math.round(minutes * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h} h ${m} min`;
  return m > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

/** Local time at the location, e.g. "16:00 (UTC+8)". */
export function formatLocalTime(epochMs: number, utcOffsetSeconds: number): string {
  const shifted = new Date(epochMs + utcOffsetSeconds * 1000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const offsetHours = utcOffsetSeconds / 3600;
  const sign = offsetHours >= 0 ? '+' : '-';
  const abs = Math.abs(offsetHours);
  const offset = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${hh}:${mm} (UTC${sign}${offset})`;
}

export function formatAge(epochMs: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - epochMs) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

export function formatDose(ug: number): string {
  if (!Number.isFinite(ug)) return '--';
  if (ug >= 100) return ug.toFixed(0);
  if (ug >= 10) return ug.toFixed(1);
  return ug.toFixed(2);
}

export function formatCigarettes(value: number): string {
  if (!Number.isFinite(value)) return '--';
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

/** Hours as a friendly string: "40 min", "2.5 h", "14 h". */
export function formatHoursEquivalent(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '--';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}
