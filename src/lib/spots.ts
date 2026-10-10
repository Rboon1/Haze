/**
 * Running and walking spots across Malaysia.
 *
 * Spot list and coordinates come from the "Boleh Lari?" project. Coordinates are approximate
 * start points. Distances are only as good as their basis:
 *  - 'sourced'  : matches at least one public source we checked (links given)
 *  - 'typical'  : a typical loop or trail length that we have NOT verified; the UI says so
 */
export type DistanceBasis = 'sourced' | 'typical';
export type Surface = 'Paved' | 'Trail' | 'Mixed';

export interface Spot {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  readonly lat: number;
  readonly lon: number;
  readonly distanceKm: number;
  readonly basis: DistanceBasis;
  readonly surface: Surface;
  readonly sources?: readonly { label: string; url: string }[];
}

const GREAT_RUNS = 'https://greatruns.com';

export const SPOTS: readonly Spot[] = [
  { id: 'klcc', name: 'KLCC Park Jogging Track', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', lat: 3.1546, lon: 101.7145,
    distanceKm: 1.3, basis: 'sourced', surface: 'Paved',
    sources: [
      { label: 'Great Runs', url: `${GREAT_RUNS}/kuala-lumpur-klcc-park/` },
      { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/KLCC_Park' },
      { label: 'Lonely Planet', url: 'https://www.lonelyplanet.com/points-of-interest/klcc-park/390779' },
    ] },
  { id: 'titiwangsa', name: 'Taman Tasik Titiwangsa', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', lat: 3.1786, lon: 101.7058,
    distanceKm: 3.0, basis: 'sourced', surface: 'Paved',
    sources: [{ label: 'Great Runs (nearly 3 km lake loop)', url: `${GREAT_RUNS}/titiwangsa-lake-park-taman-tasik-titiwangsa/` }] },
  { id: 'perdana', name: 'Perdana Botanical Garden', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', lat: 3.1426, lon: 101.6847,
    distanceKm: 3.0, basis: 'sourced', surface: 'Paved',
    sources: [{ label: 'Great Runs (about 3-4 km of paths)', url: `${GREAT_RUNS}/kuala-lumpur-perdana-botanical-gardens/` }] },
  { id: 'kiara', name: 'Bukit Kiara Trails', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', lat: 3.15, lon: 101.629, distanceKm: 5.0, basis: 'typical', surface: 'Trail' },
  { id: 'permaisuri', name: 'Taman Tasik Permaisuri', city: 'Cheras', state: 'WP Kuala Lumpur', lat: 3.0975, lon: 101.713, distanceKm: 3.0, basis: 'typical', surface: 'Paved' },
  { id: 'desapark', name: 'Desa ParkCity Central Park', city: 'Kuala Lumpur', state: 'WP Kuala Lumpur', lat: 3.1866, lon: 101.6297, distanceKm: 2.1, basis: 'typical', surface: 'Paved' },
  { id: 'gasing', name: 'Bukit Gasing Forest Park', city: 'Petaling Jaya', state: 'Selangor', lat: 3.095, lon: 101.662, distanceKm: 4.0, basis: 'typical', surface: 'Trail' },
  { id: 'shahalam', name: 'Taman Tasik Shah Alam', city: 'Shah Alam', state: 'Selangor', lat: 3.0758, lon: 101.5175, distanceKm: 3.0, basis: 'typical', surface: 'Paved' },
  { id: 'putrajaya', name: 'Putrajaya Lakeside (Precinct 2)', city: 'Putrajaya', state: 'WP Putrajaya', lat: 2.9264, lon: 101.6964, distanceKm: 5.0, basis: 'typical', surface: 'Paved' },
  { id: 'youthpark', name: 'Penang Youth Park', city: 'George Town', state: 'Penang', lat: 5.4285, lon: 100.3002, distanceKm: 3.5, basis: 'typical', surface: 'Mixed' },
  { id: 'gurney', name: 'Gurney Drive Seafront', city: 'George Town', state: 'Penang', lat: 5.438, lon: 100.31, distanceKm: 2.0, basis: 'typical', surface: 'Paved' },
  { id: 'ipoh', name: 'D.R. Seenivasagam Park', city: 'Ipoh', state: 'Perak', lat: 4.601, lon: 101.083, distanceKm: 1.5, basis: 'typical', surface: 'Paved' },
  { id: 'melaka', name: 'Melaka River Walk', city: 'Melaka', state: 'Melaka', lat: 2.196, lon: 102.249, distanceKm: 4.0, basis: 'typical', surface: 'Paved' },
  { id: 'danga', name: 'Danga Bay Waterfront', city: 'Johor Bahru', state: 'Johor', lat: 1.4733, lon: 103.72, distanceKm: 3.0, basis: 'typical', surface: 'Paved' },
  { id: 'kuantan', name: 'Teluk Cempedak Boardwalk', city: 'Kuantan', state: 'Pahang', lat: 3.812, lon: 103.372, distanceKm: 2.0, basis: 'typical', surface: 'Mixed' },
  { id: 'kuching', name: 'Kuching Waterfront', city: 'Kuching', state: 'Sarawak', lat: 1.559, lon: 110.345, distanceKm: 2.0, basis: 'typical', surface: 'Paved' },
  { id: 'tanjungaru', name: 'Tanjung Aru Beach', city: 'Kota Kinabalu', state: 'Sabah', lat: 5.947, lon: 116.045, distanceKm: 3.0, basis: 'typical', surface: 'Mixed' },
];

export const DEFAULT_SPOT_ID = 'klcc';

export function getSpot(id: string): Spot | undefined {
  return SPOTS.find((s) => s.id === id);
}

/** Distinct states in list order, for the filter. */
export function spotStates(): string[] {
  return [...new Set(SPOTS.map((s) => s.state))];
}
