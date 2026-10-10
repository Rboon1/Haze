export interface Place {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

/** Approximate city-centre coordinates used for the comparison panel. */
export const PRESET_PLACES: readonly Place[] = [
  { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869 },
  { name: 'Petaling Jaya', lat: 3.1073, lon: 101.6067 },
  { name: 'George Town (Penang)', lat: 5.4141, lon: 100.3288 },
  { name: 'Ipoh', lat: 4.5975, lon: 101.0901 },
  { name: 'Johor Bahru', lat: 1.4927, lon: 103.7414 },
  { name: 'Kuching', lat: 1.5535, lon: 110.3593 },
  { name: 'Kota Kinabalu', lat: 5.9804, lon: 116.0735 },
];

export const DEFAULT_PLACE: Place = PRESET_PLACES[0] as Place;

export function samePlace(a: Place, b: Place): boolean {
  return Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;
}

export interface RunTrack {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly lapKm: number;
  /** Approximate park location, used to fetch the air quality for the track. */
  readonly lat: number;
  readonly lon: number;
  readonly sources: readonly { label: string; url: string }[];
}

/** The only track in this prototype. Lap length is as reported by several independent sources. */
export const KLCC_TRACK: RunTrack = {
  id: 'klcc-park',
  name: 'KLCC Park jogging track',
  city: 'Kuala Lumpur',
  lapKm: 1.3,
  lat: 3.1568,
  lon: 101.7123,
  sources: [
    { label: 'Great Runs', url: 'https://greatruns.com/kuala-lumpur-klcc-park/' },
    { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/KLCC_Park' },
    { label: 'Lonely Planet', url: 'https://www.lonelyplanet.com/points-of-interest/klcc-park/390779' },
  ],
};
