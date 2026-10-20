import { useEffect, useState } from 'react'
import axios from 'axios'
import { MessageCircleQuestion } from 'lucide-react'
import { IconButton } from './WorkspacePanel'

export default function DataDiagnostics({ fileId, target, features, onAsk }) {
  const [relations, setRelations] = useState(null)
  const signature = JSON.stringify(features)
  useEffect(() => {
    let active = true
    setRelations(null)
    if (!fileId) return
    const req = { file_id: fileId, target, features }
    axios.post('/api/relationships', req).then(r => { if (active) setRelations(r.data) }).catch(e => { if (active) setRelations({ error: e.response?.data?.detail || '相関を取得できません' }) })
    return () => { active = false }
  }, [fileId, target, signature])
  if (!fileId) return null
  return <section className="work-section">
    <div className="work-heading"><h2>変数間の関係（Pearson相関）</h2><IconButton title="相関について質問" onClick={() => onAsk('この相関から何が分かり、何は分かりませんか？', JSON.stringify(relations?.pairs?.slice(0, 20) || []))}><MessageCircleQuestion size={18} /></IconButton></div>
    {!relations && <p role="status">相関を取得中...</p>}
    <p>数値列のペアごとに欠損を除外。正は緑、負は赤。相関は因果関係を示しません。</p>
    {relations?.error && <p>{relations.error}</p>}
    {relations?.excluded?.length > 0 && <p>数値以外の列: {relations.excluded.join(', ')}</p>}
    <div className="work-scroll"><table className="work-table"><thead><tr><th>変数1</th><th>変数2</th><th>相関 −1〜1</th><th>有効件数</th></tr></thead><tbody>{relations?.pairs?.map(p => <tr key={JSON.stringify([p.x, p.y])}><td>{p.x}</td><td>{p.y}</td><td><div className="correlation"><span style={{ width: `${Math.abs(p.r || 0) * 100}%`, background: p.r >= 0 ? '#16836e' : '#b6415d' }} />{p.r == null ? '計算不可' : p.r.toFixed(3)}</div></td><td>{p.n}</td></tr>)}</tbody></table></div>
    {relations?.pairs?.length === 0 && <p>比較可能な数値列が2列以上必要です</p>}
  </section>
}
