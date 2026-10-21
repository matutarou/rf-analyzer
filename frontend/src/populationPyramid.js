export function guessPyramidConfig(sheet) {
  if (!sheet) return null
  const find = (pattern, fallback) => sheet.columns.find(column => pattern.test(column)) || sheet.columns[fallback] || ''
  return {
    sheet_name: sheet.name,
    municipality_column: find(/市町村|自治体|地域|municipality/i, 0),
    sex_column: find(/性別|男女|sex|gender/i, 1),
    age_column: find(/年齢|age/i, 2),
    population_column: find(/人口|人数|population/i, 3),
  }
}

export function pyramidSeries(city, mode = 'count') {
  const bands = city?.bands || []
  const total = bands.reduce((sum, band) => sum + band.male + band.female, 0)
  const scale = mode === 'percent' ? (total ? 100 / total : 0) : 1
  const rows = bands.map(band => ({
    age: band.age_start >= 100 ? '100歳以上' : `${band.age_start}〜${band.age_start + 4}歳`,
    male: -Math.max(0, band.male) * Math.abs(scale),
    female: Math.max(0, band.female) * Math.abs(scale),
  })).reverse()
  const limit = Math.max(1, ...rows.map(row => Math.max(Math.abs(row.male), row.female))) * 1.1
  const hasNegativeBands = bands.some(band => band.male < 0 || band.female < 0)
  return { rows, total, limit, hasNegativeBands }
}
