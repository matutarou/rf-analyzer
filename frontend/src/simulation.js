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
