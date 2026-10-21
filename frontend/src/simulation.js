// 符号付きで数値を表示する（例: +12.30, -4.00）
export function signed(value, digits = 2) {
  if (!Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
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
