import { useEffect, useState } from 'react'
import axios from 'axios'
export default function FeedbackLog() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { axios.get('/api/feedback').then(r => setRows(r.data)).catch(() => setError('評価記録を読み込めません')) }, [])
  const labels = { helpful: '役立った', incorrect: '誤りがある', unclear: '分かりにくい' }
  return <div className="feedback-log">{error && <p role="alert">{error}</p>}{!rows.length && !error && <p>評価記録はありません</p>}{rows.map(r => <details key={r.id}><summary>{labels[r.rating]} / {new Date(r.created).toLocaleString()}</summary><p>{r.question}</p><p>{r.answer}</p><p>{r.comment}</p><small>{r.model}</small></details>)}</div>
}
