import { useEffect, useState } from 'react'
import axios from 'axios'
import { Save, FolderOpen, Download, Trash2, RefreshCw } from 'lucide-react'

export const IconButton = ({ title, children, ...props }) => <button type="button" className="work-icon" title={title} aria-label={title} {...props}>{children}</button>
const number = value => Number.isFinite(value) ? value.toFixed(4) : '未評価'

export default function WorkspacePanel({ snapshot, onOpen, onSave, revision, busy }) {
  const [records, setRecords] = useState([])
  const [selected, setSelected] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const refresh = async () => { setRecords((await axios.get('/api/projects')).data) }
  useEffect(() => { refresh().catch(() => setError('保存記録を取得できません')) }, [revision])
  const action = async fn => {
    setWorking(true); setError(''); setNotice('')
    try { await fn() } catch (e) { setError(typeof e.response?.data?.detail === 'string' ? e.response.data.detail : '処理に失敗しました') }
    finally { setWorking(false) }
  }
  const chosen = records.filter(r => selected.includes(r.id))
  const comparable = new Set(chosen.map(r => JSON.stringify([r.fingerprint, r.target, r.cohort]))).size <= 1
  return <section className="work-section">
    <div className="work-heading"><h2>保存・履歴比較</h2><IconButton title="履歴を更新" onClick={() => action(refresh)} disabled={working}><RefreshCw size={17} /></IconButton></div>
    <div className="work-toolbar">
      <input aria-label="保存名" placeholder="保存名" value={name} onChange={e => setName(e.target.value)} maxLength={150} />
      <IconButton title="現在の作業を保存" disabled={!snapshot.file_id || busy || working} onClick={() => action(async () => {
        await onSave()
        await refresh(); setNotice('保存しました')
      })}><Save size={18} /></IconButton>
      <button disabled={busy || working} onClick={() => action(async () => {
        await axios.post('/api/projects', { ...snapshot, name: name.trim() || `${snapshot.name}（コピー）`.slice(0, 150) })
        await refresh(); setNotice('別の履歴として保存しました')
      })}>別名保存</button>
    </div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!records.length && <p>保存記録はありません</p>}
    <div className="work-scroll"><table className="work-table"><thead><tr><th>比較</th><th>保存名 / 日時</th><th>目的変数</th><th>R²</th><th>操作</th></tr></thead><tbody>
      {records.map(r => <tr key={r.id}>
        <td><input type="checkbox" aria-label={`${r.name}を比較`} checked={selected.includes(r.id)} disabled={!selected.includes(r.id) && selected.length >= 4} onChange={e => setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))} /></td>
        <td>{r.name}<small>{new Date(r.created).toLocaleString()}</small></td><td>{r.target || '未選択'}</td><td>{number(r.results?.metrics?.cv?.r2)}</td>
        <td><div className="work-toolbar">
          <IconButton title="この記録を再開" disabled={busy || working} onClick={() => action(() => onOpen(r.id))}><FolderOpen size={17} /></IconButton>
          <a className="work-icon" href={`/api/projects/${r.id}/report`} target="_blank" rel="noreferrer" title="HTMLレポートを開く" aria-label="HTMLレポートを開く"><Download size={17} /></a>
        </div></td>
      </tr>)}
    </tbody></table></div>
    {chosen.length > 0 && <>
      <h3>比較（最大4件）</h3>{!comparable && <p role="status" className="work-warning">データ・目的変数・欠損除外行のいずれかが異なります。精度を単純に順位付けできません。</p>}
      <div className="work-scroll"><table className="work-table"><thead><tr><th>項目</th>{chosen.map(r => <th key={r.id}>{r.name}</th>)}</tr></thead><tbody>
        {['r2', 'rmse', 'mae'].map(m => <tr key={m}><th>{m.toUpperCase()}</th>{chosen.map(r => <td key={r.id}>{number(r.results?.metrics?.cv?.[m])}</td>)}</tr>)}
        <tr><th>説明変数</th>{chosen.map(r => <td key={r.id}>{r.features.join(', ')}</td>)}</tr>
        <tr><th>設定</th>{chosen.map(r => <td key={r.id}><pre>{JSON.stringify(r.params, null, 2)}</pre></td>)}</tr>
        <tr><th>重要度 上位5件</th>{chosen.map(r => <td key={r.id}>{r.results?.feature_importance?.slice(0, 5).map(f => <div key={f.feature}>{f.feature}: {number(f.importance)}</div>)}</td>)}</tr>
      </tbody></table></div>
    </>}
  </section>
}
