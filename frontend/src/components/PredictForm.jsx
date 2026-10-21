import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

import { baselineFor, changeRate, signed, sortByShap } from '../simulation'

const API_BASE = '/api'
const fmt = (v, d = 2) => (v != null ? Number(v).toFixed(d) : '—')

function sliderStep(min, max) {
  const range = max - min
  if (range <= 1) return 0.01
  if (range <= 10) return 0.1
  if (range <= 100) return 1
  return Math.round(range / 100)
}

export default function PredictForm({ fileInfo, selectedTarget, selectedFeatures, hyperParams, modelId, shapImportance }) {
  if (!fileInfo || !selectedTarget || selectedFeatures.length === 0 || !hyperParams) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header"><h2>シミュレーション</h2></div>
        <div className="card-body" style={{ color: '#94a3b8', fontSize: 13, padding: '32px 24px', textAlign: 'center' }}>
          分析完了後にシミュレーションフォームが表示されます
        </div>
      </div>
    )
  }

  return <ActivePredictForm key={JSON.stringify([fileInfo.file_id, selectedTarget, selectedFeatures, hyperParams, modelId])} fileInfo={fileInfo} selectedTarget={selectedTarget} selectedFeatures={selectedFeatures} hyperParams={hyperParams} modelId={modelId} shapImportance={shapImportance} />
}

function ActivePredictForm({ fileInfo, selectedTarget, selectedFeatures, hyperParams, modelId, shapImportance }) {
  const colMap = Object.fromEntries(fileInfo.columns.map(c => [c.name, c]))
  // 選択肢はSHAPの大きい順に表示する（APIに送る変数の順序はモデルに合わせてselectedFeaturesのまま）
  const numericFeatures = sortByShap(selectedFeatures, shapImportance).filter(f => /^(u?int|float|Float|Int|bool)/i.test(colMap[f]?.dtype || ''))

  const meanValues = Object.fromEntries(
    numericFeatures.map(f => {
      const col = colMap[f]
      return [f, col?.mean ?? col?.min ?? 0]
    })
  )

  // 対象の市町村（空なら全市町村の平均値を基準にする）
  const idCol = fileInfo.columns[0]?.name
  const [rows, setRows] = useState([])
  const [cityIndex, setCityIndex] = useState('')
  const cityRow = cityIndex === '' ? null : rows[Number(cityIndex)]
  const baselineValues = baselineFor(numericFeatures, meanValues, cityRow)
  const actualValue = cityRow?.[selectedTarget]

  const [checkedFeatures, setCheckedFeatures] = useState(new Set(numericFeatures.slice(0, 3)))
  const [sliderValues, setSliderValues] = useState({ ...baselineValues })
  const [result, setResult] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)

  const simulate = async (checked, sliders, base = baselineValues) => {
    const changed = [...checked]
    if (changed.length === 0) { setResult(null); return }

    setUpdating(true)
    try {
      const simInput = { ...base, ...Object.fromEntries(changed.map(f => [f, sliders[f]])) }
      const res = await axios.post(`${API_BASE}/predict_marginal_fast`, {
        file_id: fileInfo.file_id,
        model_id: modelId,
        target_column: selectedTarget,
        feature_columns: selectedFeatures,
        baseline_input: base,
        sim_input: simInput,
        changed_features: changed,
      })
      setResult(res.data)
      setError('')
    } catch (err) {
      const d = err.response?.data?.detail
      setError(Array.isArray(d) ? d.map(e => e.msg).join(' / ') : (d || 'シミュレーション中にエラーが発生しました'))
    } finally {
      setUpdating(false)
    }
  }

  const scheduleSimulate = (checked, sliders, base = baselineValues) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => simulate(checked, sliders, base), 300)
  }

  // 市町村を切り替えたら、スライダーをその市町村の値に戻して計算し直す
  const chooseCity = (index) => {
    setCityIndex(index)
    const base = baselineFor(numericFeatures, meanValues, index === '' ? null : rows[Number(index)])
    setSliderValues({ ...base })
    scheduleSimulate(checkedFeatures, base, base)
  }

  const toggleFeature = (f) => {
    setCheckedFeatures(prev => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      scheduleSimulate(next, sliderValues)
      return next
    })
  }

  const handleSlider = (f, v) => {
    const next = { ...sliderValues, [f]: Number(v) }
    setSliderValues(next)
    scheduleSimulate(checkedFeatures, next)
  }

  const handleReset = () => {
    setSliderValues({ ...baselineValues })
    setResult(null)
    setError('')
  }

  useEffect(() => {
    scheduleSimulate(checkedFeatures, sliderValues)
    return () => clearTimeout(debounceRef.current)
  }, [])

  useEffect(() => {
    let active = true
    axios.get(`${API_BASE}/rows/${fileInfo.file_id}`)
      .then(res => { if (active) setRows(res.data.rows) })
      .catch(() => { if (active) setRows([]) })
    return () => { active = false }
  }, [fileInfo.file_id])

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <h2>シミュレーション</h2>
        <span className="badge">目的変数: {selectedTarget}</span>
      </div>
      <div className="card-body">
        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            <p>{error}</p>
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {/* 対象の市町村 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 20 }}>
          対象
          <select aria-label="シミュレーションの対象" value={cityIndex} onChange={e => chooseCity(e.target.value)} style={{ padding: '6px 8px', fontWeight: 400 }}>
            <option value="">平均的な市町村（全市町村の平均値）</option>
            {rows.map((row, index) => <option key={index} value={index}>{String(row[idCol] ?? `${index + 1}行目`)}</option>)}
          </select>
        </label>

        {/* 変数選択 */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            シミュレーションする変数を選択
            <span className="tag tag-feature">{checkedFeatures.size}件選択中</span>
          </h3>
          <div className="column-list" style={{ maxHeight: 220 }}>
            {numericFeatures.map(f => (
              <label
                key={f}
                className={`column-item ${checkedFeatures.has(f) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checkedFeatures.has(f)}
                  onChange={() => toggleFeature(f)}
                />
                <span>{f}</span>
                <span className="col-dtype">{colMap[f]?.dtype}</span>
              </label>
            ))}
          </div>
        </div>

        {/* スライダー */}
        {[...checkedFeatures].map(f => {
          const col = colMap[f]
          const min = col?.min ?? 0
          const max = col?.max ?? 100
          const mean = col?.mean ?? (min + max) / 2
          const step = sliderStep(min, max)
          const val = sliderValues[f] ?? mean
          const pct = max > min ? ((val - min) / (max - min)) * 100 : 50

          return (
            <div key={f} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{f}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#2563eb', fontWeight: 700 }}>
                  {fmt(val, step < 1 ? 2 : 0)}
                </span>
              </div>
              <input
                type="range"
                min={min} max={max} step={step} value={val}
                onChange={e => handleSlider(f, e.target.value)}
                style={{ width: '100%', accentColor: '#2563eb' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                <span>{fmt(min, step < 1 ? 2 : 0)}</span>
                <span style={{ color: '#cbd5e1' }}>平均: {fmt(mean, step < 1 ? 2 : 0)}</span>
                <span>{fmt(max, step < 1 ? 2 : 0)}</span>
              </div>
            </div>
          )
        })}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={handleReset}>リセット</button>
          {updating && (
            <span style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 12, height: 12,
                border: '2px solid #cbd5e1', borderTopColor: '#2563eb',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
              }} />
              更新中
            </span>
          )}
        </div>

        {/* 結果 */}
        {result && (
          <div style={{ marginTop: 28 }}>
            {Object.keys(result.fixed_categories || {}).length > 0 && <p>固定カテゴリ: {Object.entries(result.fixed_categories).map(([k, v]) => `${k}=${v}`).join(', ')}</p>}
            {/* 予測値サマリ：目的変数の変更前・変更後・差分・変化率 */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              {cityRow && <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                <div className="metric-label">{selectedTarget}（実測値）</div>
                <div className="metric-value" style={{ fontSize: 20 }}>{Number.isFinite(actualValue) ? fmt(actualValue, 2) : '—'}</div>
              </div>}
              <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                <div className="metric-label">{selectedTarget}（変更前の予測）</div>
                <div className="metric-value" style={{ fontSize: 20 }}>{fmt(result.baseline, 2)}</div>
              </div>
              <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                <div className="metric-label">{selectedTarget}（変更後の予測）</div>
                <div className="metric-value" style={{ fontSize: 20, color: '#2563eb' }}>{fmt(result.simulation, 2)}</div>
              </div>
              <div className={`metric-card ${result.delta >= 0 ? 'good' : ''}`} style={{ flex: 1, minWidth: 140 }}>
                <div className="metric-label">差分（Δ）</div>
                <div className="metric-value" style={{ fontSize: 20, color: result.delta >= 0 ? '#15803d' : '#dc2626' }}>{signed(result.delta)}</div>
              </div>
              <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                <div className="metric-label">変化率</div>
                <div className="metric-value" style={{ fontSize: 20, color: result.delta >= 0 ? '#15803d' : '#dc2626' }}>{changeRate(result.baseline, result.simulation) == null ? '—' : `${signed(changeRate(result.baseline, result.simulation))}%`}</div>
              </div>
            </div>

            {/* 動かした変数ごとの値の変化と、その変数だけを変えたときの予測への影響 */}
            <div className="work-scroll" style={{ marginBottom: 24 }}><table className="work-table">
              <thead><tr><th>変数</th><th>変更前（{cityRow ? String(cityRow[idCol]) : '平均'}）</th><th>変更後</th><th>値の差</th><th>{selectedTarget}への影響</th></tr></thead>
              <tbody>{result.marginal_effects.map(e => <tr key={e.feature}>
                <th>{e.feature}</th><td>{fmt(e.from_val, 2)}</td><td>{fmt(e.to_val, 2)}</td><td>{signed(e.to_val - e.from_val)}</td>
                <td style={{ color: e.effect > 0 ? '#15803d' : e.effect < 0 ? '#dc2626' : undefined }}>{signed(e.effect)}</td>
              </tr>)}</tbody>
            </table></div>

          </div>
        )}
      </div>
    </div>
  )
}
