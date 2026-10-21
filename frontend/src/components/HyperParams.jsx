export default function HyperParams({ defaultParams, onChange, onSubmit, dataRows, featureCount, canAnalyze = false }) {
  const params = defaultParams

  const update = (key, value) => {
    onChange({ ...params, [key]: value })
  }

  const handleSubmit = () => {
    onSubmit({
      optimize: true,
      optimize_metric: 'r2',
      n_trials: Number(params.n_trials),
      shap_top_n: featureCount,
      importance_top_n: featureCount,
    })
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>ハイパーパラメータ設定</h2>
        {dataRows && <span className="badge">データ: {dataRows}行</span>}
      </div>
      <div className="card-body">

        {/* 最適化指標 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>最適化指標</div>
          <div style={{ padding: '10px 14px', borderRadius: 8, border: '1.5px solid #2563eb', background: '#dbeafe' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>決定係数 R²（最大化）</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>当てはまりの良さを評価します</div>
          </div>
        </div>

        <div className="params-grid">
          <div className="param-field">
            <label>試行回数 (n_trials)</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={params.n_trials}
              onChange={(e) => update('n_trials', e.target.value)}
            />
            <div className="hint">多いほど精度向上。時間とのトレードオフ</div>
          </div>

        </div>

        <div className="btn-group">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canAnalyze || !Number.isInteger(Number(params.n_trials)) || Number(params.n_trials) < 1 || Number(params.n_trials) > 100}>
            最適化して分析
          </button>
        </div>
      </div>
    </div>
  )
}
