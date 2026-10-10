export interface Place {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export function samePlace(a: Place, b: Place): boolean {
  return Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;
}
