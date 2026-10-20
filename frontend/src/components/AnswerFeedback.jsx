import { useState } from 'react'
import axios from 'axios'
import { ThumbsUp, ThumbsDown, MessageSquareWarning } from 'lucide-react'
import { IconButton } from './WorkspacePanel'

export default function AnswerFeedback({ answer, question = '', model }) {
  const [rating, setRating] = useState('')
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="answer-feedback">
    <div className="work-toolbar">
      {[["helpful", "役立った", ThumbsUp], ["incorrect", "誤りがある", ThumbsDown], ["unclear", "分かりにくい", MessageSquareWarning]].map(([value, label, Icon]) => <IconButton key={value} title={label} aria-pressed={rating === value} onClick={() => { setRating(value); setStatus('') }} disabled={busy}><Icon size={16} /></IconButton>)}
    </div>
    {rating && status !== '記録しました' && <><textarea aria-label="フィードバックの補足" placeholder="補足（任意）" maxLength={3000} value={comment} onChange={e => setComment(e.target.value)} /><button disabled={busy} onClick={async () => {
      setBusy(true)
      try { await axios.post('/api/feedback', { rating, answer, question, comment, model }); setStatus('記録しました') }
      catch { setStatus('保存できませんでした。再試行してください') }
      finally { setBusy(false) }
    }}>評価を記録</button></>}
    <span role="status">{status}</span>
  </div>
}
