import { useEffect, useState } from 'react'
import axios from 'axios'
import { MessageCircleQuestion } from 'lucide-react'
import { IconButton } from './WorkspacePanel'
import { correlationColor } from '../correlationHeatmap'

export default function DataDiagnostics({ fileId, target, features, onAsk }) {
  const [relations, setRelations] = useState(null)
  const [available, setAvailable] = useState([])
  const [selection, setSelection] = useState(null)
  const [focused, setFocused] = useState(null)
  // selection が null のときは全数値変数を表示する
  const selectionSignature = JSON.stringify(selection)
  useEffect(() => { setSelection(null); setFocused(null); setAvailable([]) }, [fileId])
  useEffect(() => {
    let active = true
    setRelations(null)
    setFocused(null)
    if (!fileId) return
    if (selection !== null && !selection.length) {
      setRelations({ variables: [], matrix: [], counts: [], pairs: [] })
      return
    }
    const req = { file_id: fileId, target: '', features: selection ?? [] }
    axios.post('/api/relationships', req).then(r => {
      if (active) { setRelations(r.data); setAvailable(r.data.available) }
    }).catch(e => { if (active) setRelations({ error: e.response?.data?.detail || '相関を取得できません' }) })
    return () => { active = false }
  }, [fileId, selectionSignature])
  const selected = selection ?? relations?.variables ?? []
  const variables = relations?.variables || []
  const analysisVariables = [...new Set([target, ...features].filter(name => name && available.includes(name)))]
  if (!fileId) return null
  return <section className="work-section">
    <div className="work-heading"><h2>変数間の相関ヒートマップ</h2><IconButton title="相関について質問" onClick={() => onAsk('この相関から何が分かり、何は分かりませんか？', JSON.stringify(relations?.pairs?.slice(0, 20) || []))}><MessageCircleQuestion size={18} /></IconButton></div>
    {!relations && <p role="status">相関を取得中...</p>}
    {relations?.error && <p role="alert">{relations.error}</p>}
    {available.length > 0 && <details className="heatmap-options"><summary>表示する変数を選択（{selected.length}/{available.length}）</summary>
      <div className="work-toolbar"><button type="button" onClick={() => setSelection(null)}>すべて表示</button><button type="button" disabled={!analysisVariables.length} onClick={() => setSelection(analysisVariables)}>分析の選択に合わせる</button><button type="button" onClick={() => setSelection([])}>すべて解除</button></div>
      <div className="heatmap-variable-list">{available.map(name => <label key={name}><input type="checkbox" aria-label={`相関に${name}を表示`} checked={selected.includes(name)} disabled={!relations} onChange={event => setSelection(event.target.checked ? [...selected, name] : selected.filter(value => value !== name))} />{name}</label>)}</div>
    </details>}
    {variables.length > 0 && <>
      <div className="heatmap-legend"><span>−1（負）</span><span className="heatmap-gradient" style={{ background: `linear-gradient(to right, ${correlationColor(-1)}, white, ${correlationColor(1)})` }} /><span>＋1（正）</span><span>灰色: 計算不可</span></div>
      {focused && <p role="status" className="heatmap-detail">{focused.x} × {focused.y}：r = {focused.r == null ? '計算不可' : focused.r.toFixed(3)} ／ 有効件数 {focused.n}件</p>}
      <div className="heatmap-scroll"><table className="heatmap-table" aria-label="Pearson相関ヒートマップ"><thead><tr><th scope="col">変数</th>{variables.map(name => <th scope="col" key={name} title={name}><span>{name}</span></th>)}</tr></thead><tbody>
        {variables.map((rowName, rowIndex) => <tr key={rowName}><th scope="row" title={rowName}>{rowName}</th>{variables.map((columnName, columnIndex) => {
          const value = relations.matrix[rowIndex][columnIndex]
          const count = relations.counts[rowIndex][columnIndex]
          const label = `${rowName} × ${columnName}：${value == null ? '計算不可' : value.toFixed(3)}、有効件数${count}件`
          return <td key={columnName}><button type="button" style={{ background: correlationColor(value) }} aria-label={label} title={label} onClick={() => setFocused({ x: rowName, y: columnName, r: value, n: count })}>{value == null ? '—' : value.toFixed(2)}</button></td>
        })}</tr>)}
      </tbody></table></div>
    </>}
    {relations && !relations.error && variables.length < 2 && <p>変数間の比較には数値列が2列以上必要です</p>}
  </section>
}
