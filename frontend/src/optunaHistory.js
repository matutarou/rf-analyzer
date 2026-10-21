// Optunaの推移グラフの縦軸範囲。極端に悪い試行で最良付近がつぶれないよう、下限は最良値の1.0下までにする
export function historyDomain(history = []) {
  const values = history.flatMap(item => [item.value, item.best]).filter(Number.isFinite)
  if (!values.length) return [0, 1]
  const best = Math.max(...values)
  const lower = Math.max(Math.min(...values), best - 1)
  const pad = Math.max((best - lower) * 0.05, 0.01)
  return [Math.floor((lower - pad) * 100) / 100, Math.ceil((best + pad) * 100) / 100]
}
