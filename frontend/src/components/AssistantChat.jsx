import { useState, useCallback, useRef, useEffect } from 'react'
import axios from 'axios'
import AnswerFeedback from './AnswerFeedback'
import { RotateCcw } from 'lucide-react'
import { IconButton } from './WorkspacePanel'

// RAG付き対話アシスタント。機能・統計指標の質問に、知識ベースと現在の分析結果を根拠に答える。
export default function AssistantChat({ results, apiKey, model, questionRequest, chat, onChatChange, onBusy }) {
  const messages = chat.messages || []
  const input = chat.input || ''
  const screenContext = chat.screen_context || ''
  const setInput = value => onChatChange(c => ({ ...c, input: value }))
  const setScreenContext = value => onChatChange(c => ({ ...c, screen_context: value }))
  const setMessages = update => onChatChange(c => ({ ...c, messages: update(c.messages || []) }))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const generation = useRef(0)
  const controller = useRef(null)
  const [visibleCount, setVisibleCount] = useState(40)
  useEffect(() => { onBusy(sending) }, [sending, onBusy])
  useEffect(() => {
    generation.current += 1; setError(''); setSending(false)
    return () => { generation.current += 1; controller.current?.abort() }
  }, [results])
  useEffect(() => {
    if (questionRequest) { setInput(questionRequest.question); setScreenContext(questionRequest.context) }
  }, [questionRequest])

  const previousCount = useRef(messages.length)
  useEffect(() => {
    if (messages.length > previousCount.current) endRef.current?.scrollIntoView({ behavior: 'smooth' })
    previousCount.current = messages.length
  }, [messages.length])

  const reset = () => {
    if (!window.confirm('この分析のチャットをリセットしますか？会話・入力・添付情報が削除されます。分析設定と結果は残ります。')) return
    generation.current += 1
    controller.current?.abort()
    setSending(false); setError(''); setVisibleCount(40)
    onChatChange({ messages: [], input: '', screen_context: '' })
  }

  const handleSend = useCallback(async () => {
    const question = input.trim()
    if (!question || sending) return
    const version = generation.current
    if (!apiKey.trim()) {
      setError('OpenAI APIキーを入力してください。')
      return
    }
    setError('')
    setSending(true)
    // 直近の会話履歴（user/assistantのみ）を渡す
    const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setInput('')
    try {
      controller.current = new AbortController()
      const res = await axios.post('/api/assistant/chat', {
        api_key: apiKey.trim(),
        model,
        question,
        history,
        results: results ?? null,
        screen_context: screenContext.slice(0, 12000),
      }, { signal: controller.current.signal })
      if (version !== generation.current) return
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.reply,
        sources: res.data.sources ?? [],
        question,
        model,
      }])
    } catch (err) {
      if (version !== generation.current) return
      const d = err.response?.data?.detail
      setError(d || '応答の生成に失敗しました')
    } finally {
      if (version === generation.current) setSending(false)
    }
  }, [input, apiKey, model, messages, results, screenContext, sending, onChatChange])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="chat-content">
      <div className="work-heading"><h3>チャット</h3><IconButton title="チャットをリセット" disabled={!messages.length && !input && !screenContext && !sending} onClick={reset}><RotateCcw size={18} /></IconButton></div>
      <p className="explain-description">
        機能の使い方や指標（R²・SHAP等）について<br />質問できます。
      </p>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">例:「R²はどのくらいなら良いの？」「SHAPと特徴量重要度の違いは？」</div>
        )}
        {messages.length > visibleCount && <button onClick={() => setVisibleCount(n => n + 40)}>以前の会話を表示</button>}
        {messages.slice(-visibleCount).map((m, i) => (
          <div key={messages.length - Math.min(visibleCount, messages.length) + i} className={`chat-msg chat-msg--${m.role}`}>
            <div className="chat-msg-bubble">{m.content}</div>
            {m.sources?.length > 0 && (
              <div className="chat-sources">
                {m.sources.map((s, j) => <details key={j}>
                  <summary>検索候補 [{s.id}] {s.doc_name} / {s.page ? `${s.page}ページ` : `部分${s.chunk}`}</summary>
                  <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.text}</blockquote>
                </details>)}
              </div>
            )}
            {m.role === 'assistant' && <AnswerFeedback answer={m.content} question={m.question} model={m.model} />}
          </div>
        ))}
        {sending && <div className="chat-msg chat-msg--assistant"><div className="chat-msg-bubble chat-typing">考え中...</div></div>}
        <div ref={endRef} />
      </div>

      {error && <div className="explain-error">{error}</div>}
      {screenContext && <details><summary>質問に添付する画面情報</summary><pre className="screen-context">{screenContext}</pre><button onClick={() => setScreenContext('')}>添付を解除</button></details>}

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="質問を入力（Enterで送信 / Shift+Enterで改行）"
          rows={2}
          disabled={sending}
        />
        <button className="chat-send" onClick={handleSend} disabled={sending || !input.trim()}>
          送信
        </button>
      </div>
    </div>
  )
}
