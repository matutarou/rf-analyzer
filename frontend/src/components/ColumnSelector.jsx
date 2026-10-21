import { featureColumns } from '../workbookSelection'

export default function ColumnSelector({ columns, onSelect, onProceed, initialTarget = '', initialFeatures = [] }) {
  const target = initialTarget
  const features = initialFeatures
  const setFeatures = value => onSelect(target, typeof value === 'function' ? value(features) : value)

  if (!columns || columns.length === 0) {
    return (
      <div className="card">
        <div className="card-header"><h2>カラム選択</h2></div>
        <div className="card-body" style={{ color: '#94a3b8', fontSize: 13, padding: '32px 24px', textAlign: 'center' }}>
          ファイルをアップロードするとカラムが表示されます
        </div>
      </div>
    )
  }

  // 先頭列は自治体名のため分析対象から除外
  const analysisColumns = columns.slice(1)
  const numericColumns = analysisColumns.filter(
    (c) => c.dtype.includes('int') || c.dtype.includes('float')
  )
  const allColumns = featureColumns(columns)
  const hasFactorSheet = columns.some(column => column.source_sheet === '想定される要因')

  const toggleFeature = (name) => {
    setFeatures((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name]
    )
  }

  const selectAllFeatures = () => {
    const available = allColumns
      .map((c) => c.name)
      .filter((name) => name !== target)
    setFeatures(available)
  }

  const clearFeatures = () => setFeatures([])

  const canProceed = target && features.length > 0

  return (
    <div className="card">
      <div className="card-header">
        <h2>カラム選択</h2>
      </div>
      <div className="card-body">
        <div className="column-grid">
          {/* 目的変数 */}
          <div className="column-section">
            <h3>
              目的変数（予測対象）
              <span className="tag tag-target">1つ選択</span>
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
              数値型のカラムのみ選択可能です
            </p>
            <div className="column-list">
              {numericColumns.map((col) => (
                <label
                  key={col.name}
                  className={`column-item ${target === col.name ? 'selected-target' : ''}`}
                >
                  <input
                    type="radio"
                    name="target"
                    value={col.name}
                    checked={target === col.name}
                    onChange={() => {
                      onSelect(col.name, features.filter(f => f !== col.name))
                    }}
                  />
                  <span>{col.name}</span>
                  <span className="col-dtype">{col.dtype}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 特徴量 */}
          <div className="column-section">
            <h3>
              説明変数（特徴量）
              <span className="tag tag-feature">複数選択可</span>
            </h3>
            {hasFactorSheet && <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>「想定される要因」シートの列から選択してください（自治体名・結合キーは除外）。</p>}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={selectAllFeatures}
              >
                全選択
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={clearFeatures}
              >
                クリア
              </button>
              <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>
                {features.length}件選択中
              </span>
            </div>
            <div className="column-list">
              {allColumns
                .filter((col) => col.name !== target)
                .map((col) => (
                  <label
                    key={col.name}
                    className={`column-item ${features.includes(col.name) ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={features.includes(col.name)}
                      onChange={() => toggleFeature(col.name)}
                    />
                    <span>{col.name}</span>
                    <span className="col-dtype">{col.dtype}</span>
                  </label>
                ))}
            </div>
          </div>
        </div>

        <div className="btn-group">
          <button
            className="btn btn-primary"
            disabled={!canProceed}
            onClick={onProceed}
          >
            次へ：パラメータ設定
          </button>
        </div>
      </div>
    </div>
  )
}
