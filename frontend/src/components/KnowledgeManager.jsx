import { useState, useCallback, useEffect, useRef } from 'react'
import axios from 'axios'

// 知識ベース管理。機能・指標の説明用ドキュメント（PDF/Word/テキスト）を登録・削除する。
export default function KnowledgeManager({ apiKey }) {
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileRef = useRef(null)

  const loadDocs = useCallback(async () => {
    try {
      const res = await axios.get('/api/knowledge/list')
      setDocuments(res.data.documents)
    } catch {
      /* 一覧取得失敗は無視（空表示） */
    }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!apiKey.trim()) {
      setError('OpenAI APIキーを入力してください。')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('api_key', apiKey.trim())
      const res = await axios.post('/api/knowledge/ingest', fd)
      setNotice(`「${res.data.doc_name}」を登録しました（${res.data.chunks}チャンク）`)
      await loadDocs()
    } catch (err) {
      const d = err.response?.data?.detail
      setError(d || 'ドキュメントの登録に失敗しました')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [apiKey, loadDocs])

  const handleDelete = useCallback(async (name) => {
    try {
      await axios.delete(`/api/knowledge/${encodeURIComponent(name)}`)
      await loadDocs()
    } catch (err) {
      setError(err.response?.data?.detail || '削除に失敗しました')
    }
  }, [loadDocs])

  return (
    <div className="knowledge-content">
      <p className="explain-description">
        機能・指標の説明に使う資料を登録します。<br />
        登録した内容はアシスタントの回答根拠になります。
      </p>

      <label className={`btn-explain ${uploading ? 'btn-explain--loading' : ''}`} style={{ cursor: 'pointer' }}>
        {uploading ? (<><span className="btn-explain-spinner" />登録中...</>) : 'ドキュメントを追加'}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          onChange={handleUpload}
          disabled={uploading}
          style={{ display: 'none' }}
        />
      </label>
      <p className="explain-apikey-hint">対応形式: PDF / Word(.docx) / テキスト(.txt, .md)</p>

      {notice && <div className="knowledge-notice">{notice}</div>}
      {error && <div className="explain-error">{error}</div>}

      <div className="knowledge-list">
        {documents.length === 0 ? (
          <div className="chat-empty">まだドキュメントが登録されていません</div>
        ) : (
          documents.map((d) => (
            <div key={d.doc_name} className="knowledge-item">
              <div className="knowledge-item-info">
                <span className="knowledge-item-name">{d.doc_name}</span>
                <span className="knowledge-item-chunks">{d.chunks} チャンク</span>
              </div>
              <button className="knowledge-item-delete" onClick={() => handleDelete(d.doc_name)} title="削除">
                削除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
