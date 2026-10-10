/** US AQI categories (the scale Open-Meteo reports). This is NOT Malaysia's own API/IPU scale. */
export interface AqiCategory {
  readonly id: 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous';
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly color: string;
  readonly textColor: string;
  /** Plain-language summary of the air, not medical advice. */
  readonly summary: string;
  /** Short description of the lungs in the 3D view. */
  readonly lungs: string;
}

export const AQI_CATEGORIES: readonly AqiCategory[] = [
  { id: 'good', label: 'Good', min: 0, max: 50, color: '#4ade80', textColor: '#06210f',
    summary: 'Air quality is considered satisfactory. Little or no risk for most people.',
    lungs: 'Clear' },
  { id: 'moderate', label: 'Moderate', min: 51, max: 100, color: '#facc15', textColor: '#2b2200',
    summary: 'Acceptable for most people. Unusually sensitive people may notice symptoms.',
    lungs: 'Mildly irritated' },
  { id: 'sensitive', label: 'Unhealthy for sensitive groups', min: 101, max: 150, color: '#fb923c', textColor: '#2a1200',
    summary: 'Children, older adults and people with asthma or heart or lung conditions are more likely to be affected.',
    lungs: 'Irritated' },
  { id: 'unhealthy', label: 'Unhealthy', min: 151, max: 200, color: '#f87171', textColor: '#2a0606',
    summary: 'Everyone may begin to feel effects. Sensitive groups may feel more serious effects.',
    lungs: 'Inflamed' },
  { id: 'very-unhealthy', label: 'Very unhealthy', min: 201, max: 300, color: '#c084fc', textColor: '#1d0633',
    summary: 'Health alert: the risk of effects is higher for everyone.',
    lungs: 'Heavily inflamed' },
  { id: 'hazardous', label: 'Hazardous', min: 301, max: 1000, color: '#be123c', textColor: '#ffffff',
    summary: 'Emergency conditions. Everyone is likely to be affected.',
    lungs: 'Severely stressed' },
];

export function categoryForAqi(aqi: number): AqiCategory {
  const safe = Number.isFinite(aqi) ? Math.max(0, Math.round(aqi)) : 0;
  const found = AQI_CATEGORIES.find((c) => safe >= c.min && safe <= c.max);
  return found ?? (AQI_CATEGORIES[AQI_CATEGORIES.length - 1] as AqiCategory);
}

/** 0 (clean) to 1 (hazardous). Drives lung colour in the 3D view. */
export function severityForAqi(aqi: number): number {
  if (!Number.isFinite(aqi)) return 0;
  return Math.min(1, Math.max(0, aqi / 300));
}

export type PollutantKey =
  | 'pm2_5'
  | 'pm10'
  | 'nitrogen_dioxide'
  | 'ozone'
  | 'sulphur_dioxide'
  | 'carbon_monoxide';

export const POLLUTANT_LABELS: Record<PollutantKey, string> = {
  pm2_5: 'PM2.5',
  pm10: 'PM10',
  nitrogen_dioxide: 'NO\u2082',
  ozone: 'O\u2083',
  sulphur_dioxide: 'SO\u2082',
  carbon_monoxide: 'CO',
};

/** The pollutant with the highest AQI sub-index, or null if none are available. */
export function mainPollutant(subIndices: Partial<Record<PollutantKey, number | null>>): PollutantKey | null {
  let best: PollutantKey | null = null;
  let bestValue = -Infinity;
  for (const key of Object.keys(POLLUTANT_LABELS) as PollutantKey[]) {
    const value = subIndices[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}
