// シミュレーションの変化率（%）。変更前が0や数値でないときは計算しない
export function changeRate(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null
  return (after - before) / Math.abs(before) * 100
}

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
