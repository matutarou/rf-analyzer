import { useState, useRef, useEffect } from 'react'
import axios from 'axios'

const API_BASE = '/api'

const fmtNum = (v, d = 4) => (v != null ? Number(v).toFixed(d) : '—')

export default function TestPredict({ dataMode, fileInfo, selectedTarget, selectedFeatures, hyperParams }) {
  const inputRef = useRef(null)
  const [testFileInfo, setTestFileInfo] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 単一ファイル分割モード用の状態
  const [allRows, setAllRows] = useState(null)      // { columns, rows, total }
  const [rowsLoading, setRowsLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(() => new Set())
  const [quickN, setQuickN] = useState(2)

  const isSingle = dataMode === 'single'
  const canUse = fileInfo && selectedTarget && selectedFeatures.length > 0 && hyperParams

  // 先頭列（自治体名など）を識別列として結果に表示する
  const idCol = fileInfo?.columns?.[0]?.name
  const showId = idCol && !selectedFeatures.includes(idCol) && idCol !== selectedTarget

  // 分割モードでは分析完了後に全行を取得する
  useEffect(() => {
    if (!isSingle || !canUse) return
    let cancelled = false
    setRowsLoading(true)
    setError('')
    axios.get(`${API_BASE}/rows/${fileInfo.file_id}`)
      .then((res) => { if (!cancelled) { setAllRows(res.data); setSelectedIdx(new Set()) } })
      .catch((err) => {
        if (cancelled) return
        const d = err.response?.data?.detail
        setError(Array.isArray(d) ? d.map(e => e.msg).join(' / ') : (d || '行データの取得に失敗しました'))
      })
      .finally(() => { if (!cancelled) setRowsLoading(false) })
    return () => { cancelled = true }
  }, [isSingle, canUse, fileInfo?.file_id])

  if (!canUse) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header"><h2>テストデータ予測</h2></div>
        <div className="card-body" style={{ color: '#94a3b8', fontSize: 13, padding: '32px 24px', textAlign: 'center' }}>
          分析完了後にテストデータを指定できます
        </div>
      </div>
    )
  }

  // ---- 別ファイル（separate）モード ----
  const handleFile = async (file) => {
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await axios.post(`${API_BASE}/upload`, formData)
      setTestFileInfo(res.data)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(Array.isArray(d) ? d.map(e => e.msg).join(' / ') : (d || 'アップロードに失敗しました'))
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleReset = () => {
    setTestFileInfo(null)
    setResult(null)
    setError('')
  }

  // ---- 予測実行（モードで分岐） ----
  const handlePredict = async () => {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const params = {
        n_estimators: hyperParams.n_estimators ?? 100,
        max_depth: hyperParams.max_depth ?? null,
        min_samples_split: hyperParams.min_samples_split ?? 2,
        min_samples_leaf: hyperParams.min_samples_leaf ?? 1,
        max_features: hyperParams.max_features ?? null,
        random_state: hyperParams.random_state ?? 77,
      }
      let res
      if (isSingle) {
        res = await axios.post(`${API_BASE}/predict_split`, {
          file_id: fileInfo.file_id,
          target_column: selectedTarget,
          feature_columns: selectedFeatures,
          test_indices: [...selectedIdx].sort((a, b) => a - b),
          ...params,
        })
      } else {
        res = await axios.post(`${API_BASE}/predict_test`, {
          train_file_id: fileInfo.file_id,
          test_file_id: testFileInfo.file_id,
          target_column: selectedTarget,
          feature_columns: selectedFeatures,
          ...params,
        })
      }
      setResult(res.data)
    } catch (err) {
      const d = err.response?.data?.detail
      setError(Array.isArray(d) ? d.map(e => e.msg).join(' / ') : (d || '予測中にエラーが発生しました'))
    } finally {
      setLoading(false)
    }
  }

  // ---- 行選択（single）操作 ----
  const toggleRow = (idx) => {
    setSelectedIdx((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }
  const selectHead = (n) => setSelectedIdx(new Set(Array.from({ length: Math.min(n, allRows.total) }, (_, i) => i)))
  const selectTail = (n) => {
    const total = allRows.total
    setSelectedIdx(new Set(Array.from({ length: Math.min(n, total) }, (_, i) => total - 1 - i)))
  }
  const clearSel = () => setSelectedIdx(new Set())

  // ---- CSVダウンロード ----
  const handleDownload = () => {
    const cols = [...(showId ? [idCol] : []), ...selectedFeatures, selectedTarget, '予測値']
    const header = cols.join(',')
    const body = result.rows.map(row => [
      ...(showId ? [row[idCol] ?? ''] : []),
      ...selectedFeatures.map(f => row[f] ?? ''),
      row['__actual__'] ?? '',
      fmtNum(row['__predicted__'], 4),
    ].join(',')).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'predictions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <h2>テストデータ予測</h2>
        <span className="badge">目的変数: {selectedTarget}</span>
      </div>
      <div className="card-body">
        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            <p>{error}</p>
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {isSingle ? (
          /* ===== 単一ファイル：行を指定してテストデータにする ===== */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#374151' }}>
                テストにする行を選択（<strong>{selectedIdx.size}</strong> / {allRows?.total ?? '—'} 行）
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <input
                  type="number" min={1} max={allRows?.total ?? 1} value={quickN}
                  onChange={(e) => setQuickN(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 56, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
                />
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => selectHead(quickN)}>先頭N行</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => selectTail(quickN)}>末尾N行</button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={clearSel}>選択解除</button>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={handlePredict} disabled={loading || selectedIdx.size === 0}>
                  {loading ? '予測中...' : '予測実行'}
                </button>
              </div>
            </div>

            {rowsLoading ? (
              <div style={{ color: '#94a3b8', fontSize: 13, padding: '24px', textAlign: 'center' }}>行データを読み込み中...</div>
            ) : allRows && (
              <div className="preview-table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={allRows.total > 0 && selectedIdx.size === allRows.total}
                          onChange={(e) => e.target.checked ? selectHead(allRows.total) : clearSel()}
                        />
                      </th>
                      <th style={{ width: 44 }}>#</th>
                      {allRows.columns.map(c => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.rows.map((row) => {
                      const idx = row['__index__']
                      const checked = selectedIdx.has(idx)
                      return (
                        <tr
                          key={idx}
                          onClick={() => toggleRow(idx)}
                          style={{ cursor: 'pointer', background: checked ? '#eff6ff' : undefined }}
                        >
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={checked} readOnly />
                          </td>
                          <td style={{ color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>{idx + 1}</td>
                          {allRows.columns.map(c => <td key={c}>{row[c] != null ? String(row[c]) : '—'}</td>)}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
              選択した行がテストデータ、それ以外が学習データになります。
            </p>
          </div>
        ) : (
          /* ===== 別ファイル：テストデータをアップロード ===== */
          <>
            {!testFileInfo ? (
              <div
                className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                style={{ padding: '32px 24px', margin: 0 }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
              >
                <h3 style={{ fontSize: 16 }}>テストデータをアップロード</h3>
                <p style={{ fontSize: 13 }}>特徴量カラムを含むCSV / TSV / Excel</p>
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                  目的変数（{selectedTarget}）があれば精度指標も算出します
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{testFileInfo.filename}</div>
                    <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                      {testFileInfo.rows.toLocaleString()} 行 / {testFileInfo.columns.length} カラム
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={handleReset}>
                    変更
                  </button>
                  <button className="btn btn-primary" onClick={handlePredict} disabled={loading}>
                    {loading ? '予測中...' : '予測実行'}
                  </button>
                </div>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.xlsx"
              onChange={(e) => { const f = e.target.files[0]; if (f) handleFile(f) }}
              style={{ display: 'none' }}
            />
          </>
        )}

        {/* 精度指標 */}
        {result?.metrics && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>精度指標（実測値あり）</div>
            <div className="metrics-grid" style={{ marginBottom: 0 }}>
              <div className={`metric-card ${result.metrics.r2 >= 0.7 ? 'good' : result.metrics.r2 >= 0.4 ? 'warn' : ''}`}>
                <div className="metric-label">R²</div>
                <div className="metric-value">{fmtNum(result.metrics.r2)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">RMSE</div>
                <div className="metric-value">{fmtNum(result.metrics.rmse, 2)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">MAE</div>
                <div className="metric-value">{fmtNum(result.metrics.mae, 2)}</div>
              </div>
              {result.metrics.mape != null && (
                <div className="metric-card">
                  <div className="metric-label">MAPE</div>
                  <div className="metric-value">{fmtNum(result.metrics.mape * 100, 1)}%</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 予測結果テーブル */}
        {result && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                予測結果（{result.rows.length} 件）
              </div>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={handleDownload}>
                CSV ダウンロード
              </button>
            </div>
            <div className="preview-table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="preview-table">
                <thead>
                  <tr>
                    {showId && <th>{idCol}</th>}
                    {selectedFeatures.map(f => <th key={f}>{f}</th>)}
                    {result.has_actual && <th>{selectedTarget}（実測）</th>}
                    <th style={{ color: '#2563eb' }}>{selectedTarget}（予測）</th>
                    {result.has_actual && <th>誤差</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => {
                    const pred = row['__predicted__']
                    const actual = row['__actual__']
                    const diff = actual != null ? actual - pred : null
                    return (
                      <tr key={i}>
                        {showId && <td style={{ fontWeight: 600, color: '#1e293b' }}>{row[idCol] ?? '—'}</td>}
                        {selectedFeatures.map(f => <td key={f}>{row[f] ?? '—'}</td>)}
                        {result.has_actual && <td>{fmtNum(actual, 2)}</td>}
                        <td style={{ color: '#2563eb', fontWeight: 600 }}>{fmtNum(pred, 2)}</td>
                        {result.has_actual && (
                          <td style={{ color: diff > 0 ? '#16a34a' : '#dc2626' }}>
                            {diff != null ? (diff > 0 ? '+' : '') + fmtNum(diff, 2) : '—'}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
