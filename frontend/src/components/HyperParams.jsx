import { useState } from 'react'

const METRICS = [
  { value: 'r2',   label: 'R²（最大化）',  desc: '決定係数。当てはまりの良さ' },
  { value: 'rmse', label: 'RMSE（最小化）', desc: '平均二乗誤差の平方根' },
  { value: 'mae',  label: 'MAE（最小化）',  desc: '平均絶対誤差' },
]

export default function HyperParams({ defaultParams, onChange, onSubmit, dataRows, featureCount, canAnalyze = false }) {
  const params = defaultParams

  const update = (key, value) => {
    onChange({ ...params, [key]: value })
  }

  const handleSubmit = () => {
    onSubmit({
      optimize: true,
      optimize_metric: params.optimize_metric,
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

        {/* 交差検証方式 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>交差検証</div>
          <div style={{
            padding: '10px 16px', borderRadius: 8,
            border: '1.5px solid #2563eb', background: '#dbeafe',
            display: 'inline-flex', flexDirection: 'column', gap: 2,
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#1e3a8a' }}>Leave-One-Out CV（一つ抜き交差検証）</span>
            <span style={{ fontSize: 11, color: '#475569' }}>各サンプルを1件ずつ検証。少数データでも学習量を最大化できます</span>
          </div>
        </div>

        {/* 最適化指標 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>最適化指標</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {METRICS.map((m) => (
              <label
                key={m.value}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
                  padding: '10px 14px', borderRadius: 8,
                  border: `1.5px solid ${params.optimize_metric === m.value ? '#2563eb' : '#cbd5e1'}`,
                  background: params.optimize_metric === m.value ? '#dbeafe' : '#fff',
                  flex: '1 1 140px', minWidth: 130,
                }}
              >
                <input
                  type="radio"
                  name="optimize_metric"
                  value={m.value}
                  checked={params.optimize_metric === m.value}
                  onChange={() => update('optimize_metric', m.value)}
                  style={{ marginTop: 2, accentColor: '#2563eb' }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{m.desc}</div>
                </div>
              </label>
            ))}
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
