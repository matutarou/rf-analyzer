import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { PanelLeft, Plus, Trash2, X } from 'lucide-react'
import { IconButton } from './WorkspacePanel'

const LAST_PROJECT = 'rf_analyzer_last_project'
const fresh = (name = '') => ({ id: crypto.randomUUID(), version: 0, state: name ? { name } : {}, file_info: null })

export default function AnalysisHistory({ Workspace }) {
  const [active, setActive] = useState(null)
  const [records, setRecords] = useState([])
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const newDialog = useRef(null)
  const workspace = useRef(null)
  useEffect(() => {
    if (creating) newDialog.current.showModal()
    else if (newDialog.current.open) newDialog.current.close()
  }, [creating])
  useEffect(() => {
    if (!open) return
    const close = event => { if (event.key === 'Escape' && !creating) setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, creating])
  const refresh = async () => setRecords((await axios.get('/api/projects?compact=true')).data)
  useEffect(() => {
    let live = true
    const init = async () => {
      const id = localStorage.getItem(LAST_PROJECT)
      try {
        const record = id ? (await axios.post(`/api/projects/${id}/restore`)).data : fresh()
        if (live) setActive(record)
      } catch (e) {
        if (!live) return
        if (e.response?.status === 404) setActive(fresh())
        else setError('履歴を読み込めません。サーバーの接続を確認して再読み込みしてください。')
      }
    }
    init()
    return () => { live = false }
  }, [])
  useEffect(() => { refresh().catch(() => setError('履歴一覧を取得できません')) }, [revision, open])
  const change = async (id, name = '') => {
    if (switching || id === active?.id) return
    setSwitching(true); setError('')
    try {
      await workspace.current?.flush()
      const next = id ? (await axios.post(`/api/projects/${id}/restore`)).data : fresh(name)
      setActive(next); localStorage.setItem(LAST_PROJECT, next.id); setOpen(false); setCreating(false)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || '保存できなかったため切り替えを中止しました')
    } finally { setSwitching(false) }
  }
  const startNew = () => {
    if (switching || !active) return
    setNewName(''); setError(''); setCreating(true)
  }
  const remove = async (record) => {
    if (!window.confirm(`「${record.name}」を削除しますか？元に戻せません。`)) return
    setSwitching(true); setError('')
    try {
      await workspace.current?.flush()
      await axios.delete(`/api/projects/${record.id}`)
      if (record.id === active?.id) {
        const next = fresh(); setActive(next); localStorage.setItem(LAST_PROJECT, next.id)
      }
      await refresh()
    } catch (e) { setError(e.response?.data?.detail || e.message || '削除できませんでした') }
    finally { setSwitching(false) }
  }
  return <div className="history-shell">
    <div className="history-toggle"><IconButton title="分析履歴を開く" onClick={() => setOpen(true)}><PanelLeft size={20} /></IconButton></div>
    {open && <button className="history-shade" aria-label="履歴を閉じる" onClick={() => setOpen(false)} />}
    <aside className={`history-sidebar ${open ? 'is-open' : ''}`} aria-label="分析履歴">
      <div className="work-heading"><h2>分析履歴</h2><IconButton title="履歴を閉じる" onClick={() => setOpen(false)}><X size={18} /></IconButton></div>
      <button className="history-new" disabled={switching || !active} onClick={startNew}><Plus size={18} />新しい分析</button>
      <nav>{records.map(r => <div className={`history-item ${active?.id === r.id ? 'is-active' : ''}`} key={r.id}>
        <button className="history-select" disabled={switching || !active} aria-current={active?.id === r.id ? 'page' : undefined} onClick={() => change(r.id)}>
          <strong>{r.name}</strong><small>{r.target || '変数未選択'} · {new Date(r.updated).toLocaleString()}</small>
        </button>
        <IconButton title={`「${r.name}」を削除`} disabled={switching || !active} onClick={() => remove(r)}><Trash2 size={16} /></IconButton>
      </div>)}</nav>
    </aside>
    <dialog ref={newDialog} className="history-new-dialog" aria-labelledby="new-analysis-title" onCancel={event => { event.preventDefault(); if (!switching) setCreating(false) }}>
      <form onSubmit={event => { event.preventDefault(); if (newName.trim()) change(null, newName.trim()) }}>
        <h2 id="new-analysis-title">新しい分析を作成</h2>
        <label htmlFor="new-analysis-name">分析名</label>
        <input id="new-analysis-name" autoFocus required maxLength={150} placeholder="例：人口と公共施設の分析" value={newName} disabled={switching} onChange={event => setNewName(event.target.value)} />
        {error && <p role="alert" className="work-warning">{error}</p>}
        <div className="btn-group">
          <button type="button" className="btn" disabled={switching} onClick={() => setCreating(false)}>キャンセル</button>
          <button type="submit" className="btn btn-primary" disabled={switching || !newName.trim()}>{switching ? '作成中...' : '作成'}</button>
        </div>
      </form>
    </dialog>
    {error && !creating && <div className="history-error" role="alert">{error}<IconButton title="エラーを閉じる" onClick={() => setError('')}><X size={16} /></IconButton></div>}
    {switching && <div className="history-transition" role="status">作業状態を保存しています...</div>}
    <div inert={switching || open ? '' : undefined}>
      {active ? <Workspace key={active.id} ref={workspace} initial={active} onOpen={change} onNew={startNew} onSaved={() => { localStorage.setItem(LAST_PROJECT, active.id); setRevision(v => v + 1) }} /> : <p className="history-loading">履歴を読み込んでいます...</p>}
    </div>
  </div>
}
