import { featureColumns, targetColumns } from '../workbookSelection'

export default function ColumnSelector({ columns, onSelect, initialTarget = '', initialFeatures = [], nTrials, onTrialsChange, canAnalyze = false, onAnalyze }) {
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

  const numericColumns = targetColumns(columns)
  const allColumns = featureColumns(columns)

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
  const trialsValid = Number.isInteger(Number(nTrials)) && Number(nTrials) >= 1 && Number(nTrials) <= 100

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

        {/* Optunaの試行回数を設定して、そのまま分析を実行する */}
        <div className="btn-group" style={{ alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
            試行回数
            <input type="number" min={1} max={100} step={1} value={nTrials} onChange={(e) => onTrialsChange(e.target.value)} style={{ width: 72, padding: '6px 8px' }} />
          </label>
          <button
            className="btn btn-primary"
            disabled={!canProceed || !canAnalyze || !trialsValid}
            onClick={onAnalyze}
          >
            分析を実行
          </button>
        </div>
      </div>
    </div>
  )
}
