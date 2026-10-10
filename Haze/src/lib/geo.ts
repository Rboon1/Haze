import type { Place } from './places';

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

export class GeoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoError';
  }
}

/** Search Malaysian places by name (Open-Meteo geocoding). Query is sent to the service, nothing is stored. */
export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 80) throw new GeoError('Type 2 to 80 characters to search.');
  const params = new URLSearchParams({ name: q, count: '6', language: 'en', countryCode: 'MY', format: 'json' });
  let response: Response;
  try {
    response = await fetchImpl(`${GEOCODE_ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GeoError('Could not reach the place search service.');
  }
  if (!response.ok) throw new GeoError('The place search service returned an error.');
  const body: unknown = await response.json().catch(() => null);
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const places: Place[] = [];
  for (const item of results) {
    const r = item as Record<string, unknown>;
    if (typeof r['name'] === 'string' && typeof r['latitude'] === 'number' && typeof r['longitude'] === 'number') {
      const region = typeof r['admin1'] === 'string' ? `, ${r['admin1']}` : '';
      places.push({ name: `${r['name']}${region}`, lat: r['latitude'], lon: r['longitude'] });
    }
  }
  return places;
}

/** Ask the browser for the user's position. Called only from a user action or when permission was already granted. */
export function getBrowserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('Your browser does not support location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        reject(
          new GeoError(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Search for a place instead.'
              : 'Could not determine your location. Search for a place instead.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export async function locationPermissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
