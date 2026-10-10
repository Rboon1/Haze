/**
 * Run verdict (ported from Haze/src/lib/recommend.ts). Thresholds on current hourly PM2.5 (ug/m3):
 *  - go:      <= 15  (WHO 2021 24-hour guideline value)
 *  - caution: <= 35  (US EPA 24-hour standard)
 *  - avoid:   >  35
 * If the US AQI is 151 or higher, the verdict is raised one level.
 */
export const GO_MAX_PM25 = 15;
export const CAUTION_MAX_PM25 = 35;
export const AQI_ESCALATION = 151;

const ORDER = ['go', 'caution', 'avoid'];

export function recommend(pm25, usAqi) {
  const reasons = [];
  let index = pm25 <= GO_MAX_PM25 ? 0 : pm25 <= CAUTION_MAX_PM25 ? 1 : 2;
  reasons.push(
    index === 0
      ? `PM2.5 is ${pm25.toFixed(0)} \u00b5g/m\u00b3, within the WHO 24-hour guideline of ${GO_MAX_PM25}.`
      : `PM2.5 is ${pm25.toFixed(0)} \u00b5g/m\u00b3, above the WHO 24-hour guideline of ${GO_MAX_PM25}.`,
  );
  if (index === 1) reasons.push('Running multiplies how much air you breathe, so consider a shorter or easier session.');
  if (usAqi >= AQI_ESCALATION && index < 2) {
    index += 1;
    reasons.push(`The 24-hour US AQI is ${Math.round(usAqi)} (unhealthy), so recent exposure has been high. Raised one level.`);
  }
  if (index === 2) reasons.push('Consider waiting for cleaner air or exercising indoors.');
  return { verdict: ORDER[index], reasons };
}

/**
 * The cleanest forecast hour within the next 24 h, only if it is at least 20% lower than now.
 * Returns null when waiting would not help.
 */
export function bestWindow(forecast, nowPm25, now) {
  const upcoming = forecast.filter((p) => p.epoch >= now - 30 * 60 * 1000);
  let best = null;
  for (const point of upcoming) {
    if (best === null || point.pm25 < best.pm25) best = point;
  }
  if (best === null || best.pm25 > nowPm25 * 0.8) return null;
  return { epoch: best.epoch, pm25: best.pm25 };
}
