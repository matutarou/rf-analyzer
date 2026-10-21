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
  const signature = JSON.stringify(features)
  const selectionSignature = JSON.stringify(selection)
  useEffect(() => { setSelection(null); setFocused(null) }, [fileId, target, signature])
  useEffect(() => { setAvailable([]) }, [fileId])
  useEffect(() => {
    let active = true
    setRelations(null)
    setFocused(null)
    if (!fileId) return
    if (selection !== null && !selection.length) {
      setRelations({ variables: [], matrix: [], counts: [], pairs: [] })
      return
    }
    const selected = selection ?? [...new Set([target, ...features].filter(Boolean))].slice(0, 40)
    const req = { file_id: fileId, target: '', features: selected }
    axios.post('/api/relationships', req).then(r => {
      if (active) { setRelations(r.data); setAvailable(r.data.available) }
    }).catch(e => { if (active) setRelations({ error: e.response?.data?.detail || '相関を取得できません' }) })
    return () => { active = false }
  }, [fileId, target, signature, selectionSignature])
  const selected = selection ?? relations?.variables ?? []
  const variables = relations?.variables || []
  const limited = relations?.truncated || (selection === null && new Set([target, ...features].filter(Boolean)).size > 40)
  if (!fileId) return null
  return <section className="work-section">
    <div className="work-heading"><h2>変数間の相関ヒートマップ</h2><IconButton title="相関について質問" onClick={() => onAsk('この相関から何が分かり、何は分かりませんか？', JSON.stringify(relations?.pairs?.slice(0, 20) || []))}><MessageCircleQuestion size={18} /></IconButton></div>
    {!relations && <p role="status">相関を取得中...</p>}
    <p>Pearson相関。正は緑、負は赤で、色が濃いほど相関が強くなります。相関は因果関係を示しません。</p>
    <p>欠損・無限値をペアごとに除外します。有効件数が3件未満、または変数が定数の場合は「—」です。</p>
    {relations?.error && <p role="alert">{relations.error}</p>}
    {relations?.excluded?.length > 0 && <p>数値以外の列: {relations.excluded.join(', ')}</p>}
    {available.length > 0 && <details className="heatmap-options"><summary>表示する変数を選択（{selected.length}/40）</summary>
      <p>最大40変数。ここでの選択は、分析に使う説明変数・目的変数を変更しません。</p>
      <div className="work-toolbar"><button type="button" onClick={() => setSelection(null)}>分析の選択に合わせる</button><button type="button" onClick={() => setSelection([])}>すべて解除</button></div>
      <div className="heatmap-variable-list">{available.map(name => <label key={name}><input type="checkbox" aria-label={`相関に${name}を表示`} checked={selected.includes(name)} disabled={!relations || (!selected.includes(name) && selected.length >= 40)} onChange={event => setSelection(event.target.checked ? [...selected, name] : selected.filter(value => value !== name))} />{name}</label>)}</div>
    </details>}
    {limited && <p role="status">表示上限のため先頭40変数を表示しています。表示する変数は選び直せます。</p>}
    {variables.length > 0 && <>
      <div className="heatmap-legend"><span>−1（負）</span><span className="heatmap-gradient" style={{ background: `linear-gradient(to right, ${correlationColor(-1)}, white, ${correlationColor(1)})` }} /><span>＋1（正）</span><span>灰色: 計算不可</span></div>
      <p>セルを選択すると、変数名と相関係数・有効件数を確認できます。表は上下左右にスクロールできます。</p>
      {focused && <p role="status" className="heatmap-detail">{focused.x} × {focused.y}：r = {focused.r == null ? '計算不可' : focused.r.toFixed(3)} ／ 有効件数 {focused.n}件</p>}
      <div className="heatmap-scroll"><table className="heatmap-table" aria-label="Pearson相関ヒートマップ"><thead><tr><th scope="col">変数</th>{variables.map(name => <th scope="col" key={name} title={name}><span>{name}</span></th>)}</tr></thead><tbody>
        {variables.map((rowName, rowIndex) => <tr key={rowName}><th scope="row" title={rowName}>{rowName}</th>{variables.map((columnName, columnIndex) => {
          const value = relations.matrix[rowIndex][columnIndex]
          const count = relations.counts[rowIndex][columnIndex]
          const label = `${rowName} × ${columnName}：${value == null ? '計算不可' : value.toFixed(3)}、有効件数${count}件`
          return <td key={columnName}><button type="button" style={{ background: correlationColor(value) }} aria-label={label} title={label} onClick={() => setFocused({ x: rowName, y: columnName, r: value, n: count })}>{value == null ? '—' : value.toFixed(2)}</button></td>
        })}</tr>)}
      </tbody></table></div>
      <details><summary>相関値の一覧を表示</summary><div className="work-scroll"><table className="work-table"><thead><tr><th>変数1</th><th>変数2</th><th>相関 −1〜1</th><th>有効件数</th></tr></thead><tbody>{relations.pairs.map(pair => <tr key={JSON.stringify([pair.x, pair.y])}><td>{pair.x}</td><td>{pair.y}</td><td>{pair.r == null ? '計算不可' : pair.r.toFixed(3)}</td><td>{pair.n}</td></tr>)}</tbody></table></div></details>
    </>}
    {relations && !relations.error && variables.length < 2 && <p>変数間の比較には数値列が2列以上必要です</p>}
  </section>
}
