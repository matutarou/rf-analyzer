// Optunaの推移グラフの縦軸範囲。極端に悪い試行で最良付近がつぶれないよう、下限は最良値の1.0下までにする
export function historyDomain(history = []) {
  const values = history.flatMap(item => [item.value, item.best]).filter(Number.isFinite)
  if (!values.length) return [0, 1]
  const best = Math.max(...values)
  const lower = Math.max(Math.min(...values), best - 1)
  const pad = Math.max((best - lower) * 0.05, 0.01)
  return [Math.floor((lower - pad) * 100) / 100, Math.ceil((best + pad) * 100) / 100]
}

// 推移グラフの表示・非表示はブラウザに保存し、再読み込み後も維持する（既定は表示）
export const HISTORY_HIDDEN_KEY = 'rf_analyzer_optuna_history_hidden'
export function readHistoryHidden(storage) {
  try {
    return (storage ?? globalThis.localStorage).getItem(HISTORY_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}
export function writeHistoryHidden(hidden, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(HISTORY_HIDDEN_KEY, String(hidden))
  } catch {
    // 保存できない環境では画面上の切り替えだけ行う
  }
}
