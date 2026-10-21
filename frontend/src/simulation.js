// 数値を表示する。1000以上は整数、それより小さい値は有効数字4桁（率のような小さい値が0.00にならないように）
export function formatValue(value) {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  return Math.abs(value) >= 1000
    ? value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })
    : value.toLocaleString('ja-JP', { maximumSignificantDigits: 4 })
}

// 符号付きで数値を表示する（例: +12.3, -0.001973）
export function signed(value) {
  if (!Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${formatValue(value)}`
}

// スライダーの刻み幅。範囲のおよそ1/100（10のべき乗）にし、整数の列は1より細かくしない
export function sliderStep(min, max, integer = false) {
  const range = max - min
  const step = range > 0 ? 10 ** Math.floor(Math.log10(range / 100)) : 1
  return integer ? Math.max(1, step) : step
}

// シミュレーションの変数をSHAP（平均|SHAP|）の大きい順に並べる。SHAPにない変数は元の順で後ろに置く
export function sortByShap(features, shapImportance = []) {
  const rank = new Map(shapImportance.map((item, index) => [item.feature, index]))
  return features
    .map((feature, index) => ({ feature, index, rank: rank.has(feature) ? rank.get(feature) : Infinity }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(item => item.feature)
}

// シミュレーションの基準値。市町村の行があればその値を使い、欠けている変数は平均値で補う
export function baselineFor(features, means, row) {
  return Object.fromEntries(features.map(feature => {
    const value = row?.[feature]
    return [feature, Number.isFinite(value) ? value : means[feature]]
  }))
}

// 選んだ行（元データの行番号）のSHAP絶対値が大きい順に変数を並べる。その行のSHAPがなければnullを返す
export function sortByRowShap(features, shap, row) {
  const index = shap?.rows?.indexOf(row) ?? -1
  if (index < 0 || !shap.values?.[index] || !shap.features) return null
  const size = new Map(shap.features.map((feature, column) => [feature, Math.abs(shap.values[index][column])]))
  return features
    .map((feature, order) => ({ feature, order, size: size.get(feature) ?? -1 }))
    .sort((a, b) => b.size - a.size || a.order - b.order)
    .map(item => item.feature)
}
