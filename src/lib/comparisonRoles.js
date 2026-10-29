function role(name) {
  const n = name.toLowerCase();
  if (/\b(gt|truth|ground[_-]?truth)\b/.test(n)) return 'truth';
  if (/\b(fus(ed|ion)|estimate|ekf|filter(ed)?)\b/.test(n)) return 'estimate';
  return null;
}

export function chooseComparison(names, truth, estimate) {
  if (names.includes(truth) && names.includes(estimate) && truth !== estimate) return { truth, estimate };
  const guessedTruth = names.find(n => role(n) === 'truth');
  const guessedEstimate = names.find(n => role(n) === 'estimate');
  const nextTruth = names.includes(truth) ? truth : (guessedTruth || names.find(n => n !== guessedEstimate) || names[0] || null);
  const nextEstimate = names.includes(estimate) && estimate !== nextTruth ? estimate
    : (guessedEstimate !== nextTruth && guessedEstimate) || names.find(n => n !== nextTruth) || null;
  return { truth: nextTruth, estimate: nextEstimate };
}

export function formatReadout(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toFixed(digits);
}
