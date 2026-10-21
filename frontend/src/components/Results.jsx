import { useState, useEffect, useRef } from 'react'

function DragScroll({ children }) {
  const ref = useRef(null)
  const dragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  return (
    <div
      ref={ref}
      style={{ overflowX: 'auto', cursor: 'grab', userSelect: 'none' }}
      onMouseDown={(e) => {
        dragging.current = true
        startX.current = e.pageX - ref.current.offsetLeft
        scrollLeft.current = ref.current.scrollLeft
        ref.current.style.cursor = 'grabbing'
      }}
      onMouseMove={(e) => {
        if (!dragging.current) return
        e.preventDefault()
        ref.current.scrollLeft = scrollLeft.current - (e.pageX - ref.current.offsetLeft - startX.current)
      }}
      onMouseUp={() => { dragging.current = false; ref.current.style.cursor = 'grab' }}
      onMouseLeave={() => { dragging.current = false; ref.current.style.cursor = 'grab' }}
    >
      <div style={{ minWidth: 500 }}>{children}</div>
    </div>
  )
}
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine, Cell,
} from 'recharts'

// value_norm (0=低/青 → 1=高/赤) をRGB補間で色に変換
function shapColor(norm) {
  const blue  = [59, 130, 246]
  const white = [255, 255, 255]
  const red   = [239, 68, 68]
  const [from, to, t] = norm <= 0.5
    ? [blue,  white, norm * 2]
    : [white, red,   (norm - 0.5) * 2]
  const r = Math.round(from[0] + (to[0] - from[0]) * t)
  const g = Math.round(from[1] + (to[1] - from[1]) * t)
  const b = Math.round(from[2] + (to[2] - from[2]) * t)
  return `rgb(${r},${g},${b})`
}

const fmtNum = (v, d = 4) => (v != null ? Number(v).toFixed(d) : '—')
const METRIC_LABEL = { r2: 'R²', rmse: 'RMSE', mae: 'MAE' }

const SHAP_HIGH_COLOR = '#ef4444'
const SHAP_LOW_COLOR  = '#3b82f6'

export default function Results({ results }) {
  const [shapTopN, setShapTopN] = useState(10)

  useEffect(() => {
    if (results) {
      setShapTopN(Math.min(10, results.shap?.importance.length ?? 10))
    }
  }, [results])

  if (!results) {
    return (
      <div className="card">
        <div className="card-header"><h2>分析結果</h2></div>
        <div className="card-body" style={{ color: '#94a3b8', fontSize: 13, padding: '32px 24px', textAlign: 'center' }}>
          分析を実行するとここに結果が表示されます
        </div>
      </div>
    )
  }

  const { metrics, best_params, shap } = results

  const r2Mean = metrics.cv.r2
  const r2Class = r2Mean >= 0.7 ? 'good' : r2Mean >= 0.4 ? 'warn' : ''

  // 特徴量名の最大文字数からYAxis幅を動的計算（日本語は1文字約13px）
  const calcYWidth = (names) => Math.max(80, Math.max(...names.map(n => n.length)) * 13 + 16)

  return (
    <div>
      {/* 評価指標 + 各Foldスコア */}
      <div className="card">
        <div className="card-header">
          <h2>評価指標</h2>
          <span className="badge">LOOCV（一つ抜き交差検証）</span>
        </div>
        <div className="card-body">
          <div className="metrics-grid">
              <div className={`metric-card ${r2Class}`}>
                <div className="metric-label">決定係数 R²</div>
                <div className="metric-value">
                  {fmtNum(metrics.cv.r2)}
                </div>
              </div>
          </div>
          <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 16, paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              全 {metrics.cv.n_samples} 件で Leave-One-Out 交差検証（各サンプルを1件だけ検証用に取り分け、残り全件で学習）を行い、
              全サンプルの予測をまとめて算出した指標です。
            </div>
          </div>

          {best_params && (
            <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 16, paddingTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 10 }}>
                Optuna 最適化パラメータ
                <span style={{ marginLeft: 8, fontWeight: 400, color: '#cbd5e1' }}>最適化指標: {METRIC_LABEL[best_params.metric] ?? best_params.metric}</span>
              </div>
              <div className="metrics-grid">
                {[
                  { label: 'n_estimators',     value: best_params.n_estimators },
                  { label: 'max_depth',         value: best_params.max_depth },
                  { label: 'min_samples_split', value: best_params.min_samples_split },
                  { label: 'min_samples_leaf',  value: best_params.min_samples_leaf },
                  { label: 'max_features',      value: best_params.max_features ?? '全特徴量' },
                ].map(({ label, value }) => (
                  <div key={label} className="metric-card">
                    <div className="metric-label">{label}</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SHAP */}
      {shap && (() => {
        const visibleShap = shap.importance.slice(0, shapTopN)
        const maxRank = shapTopN - 1
        const visibleBeeswarm = shap.beeswarm
          .filter(d => d.feature_rank < shapTopN)
          .map(d => ({ ...d, y: (maxRank - d.feature_rank) + (d.y - d.feature_rank) }))
        return (
          <div className="chart-card" style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>SHAP</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 11, color: '#64748b' }}>表示件数</label>
                <input
                  type="number"
                  min={1}
                  max={shap.importance.length}
                  value={shapTopN}
                  onChange={(e) => setShapTopN(Math.min(Math.max(1, Number(e.target.value)), shap.importance.length))}
                  style={{ width: 56, padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>/ {shap.importance.length}</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>低</span>
              <div style={{
                width: 120, height: 10, borderRadius: 5,
                background: `linear-gradient(to right, ${SHAP_LOW_COLOR}, #fff, ${SHAP_HIGH_COLOR})`,
                border: '1px solid #e2e8f0',
              }} />
              <span>高（特徴量値）</span>
            </div>
            <DragScroll>
              <ResponsiveContainer width="100%" height={Math.max(220, visibleShap.length * 60)}>
                <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="shap" type="number" name="SHAP値" tick={{ fontSize: 11 }}
                    label={{ value: 'SHAP値', position: 'bottom', fontSize: 12, offset: -2 }} />
                  <YAxis dataKey="y" type="number" name="特徴量"
                    domain={[-0.5, visibleShap.length - 0.5]}
                    ticks={visibleShap.map((_, i) => i)}
                    tickFormatter={(v) => shap.importance[maxRank - Math.round(v)]?.feature ?? ''}
                    width={calcYWidth(visibleShap.map(d => d.feature))} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v, name) => name === 'SHAP値' ? fmtNum(v) : undefined}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} />
                  <Scatter data={visibleBeeswarm} opacity={0.7} r={3}>
                    {visibleBeeswarm.map((d, i) => (
                      <Cell key={i} fill={shapColor(d.value_norm)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </DragScroll>
          </div>
        )
      })()}


    </div>
  )
}
