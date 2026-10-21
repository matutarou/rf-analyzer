// SHAP相互作用ヒートマップの表示用データ。表示する変数（重要度順）に合わせて行列を並べ替え、最大値も返す
export function interactionView(shap, featureNames) {
  if (!shap?.interaction || !shap.features) return null
  const columns = featureNames.map(name => shap.features.indexOf(name)).filter(index => index >= 0)
  if (columns.length < 2) return null
  const matrix = columns.map(i => columns.map(j => shap.interaction[i]?.[j] ?? null))
  const max = Math.max(0, ...matrix.flat().filter(Number.isFinite))
  return { features: columns.map(index => shap.features[index]), matrix, max }
}
