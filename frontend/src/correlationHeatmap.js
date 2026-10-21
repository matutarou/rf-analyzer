export function correlationColor(value) {
  if (value == null || !Number.isFinite(value)) return '#e5e7eb'
  const strength = Math.min(1, Math.abs(value)) * 0.65
  const endpoint = value >= 0 ? [22, 131, 110] : [182, 65, 93]
  return `rgb(${endpoint.map(channel => Math.round(255 + (channel - 255) * strength)).join(', ')})`
}
