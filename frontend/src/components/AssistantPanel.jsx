import { useState, useCallback, useEffect } from 'react'
import ExplainPanel from './ExplainPanel'
import AssistantChat from './AssistantChat'
import KnowledgeManager from './KnowledgeManager'
import FeedbackLog from './FeedbackLog'

const LS_KEY = 'rf_analyzer_openai_key'
const LS_MODEL_KEY = 'rf_analyzer_openai_model'

const MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini', desc: '高速・低コスト' },
  { value: 'gpt-4o',      label: 'GPT-4o',      desc: '高精度' },
  { value: 'gpt-4.1',     label: 'GPT-4.1',     desc: '最新・高精度' },
  { value: 'gpt-4.1-mini',label: 'GPT-4.1 mini', desc: '最新・低コスト' },
  { value: 'gpt-5',       label: 'GPT-5',        desc: '最高精度' },
]

const TABS = [
  { id: 'explain',   label: 'AI解説' },
  { id: 'chat',      label: 'アシスタント' },
  { id: 'knowledge', label: '知識ベース' },
  { id: 'feedback', label: '回答評価' },
]

// 右パネル全体。APIキー・モデルを集約し、3機能をタブで切り替える。
export default function AssistantPanel({ results, ai, onAiChange, questionRequest, chat, onChatChange, tab, setTab, onBusy }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS_KEY) ?? '')
  const [model, setModel] = useState(() => localStorage.getItem(LS_MODEL_KEY) ?? 'gpt-4o-mini')
  const [showKey, setShowKey] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [explainBusy, setExplainBusy] = useState(false)
  useEffect(() => { onBusy(chatBusy || explainBusy) }, [chatBusy, explainBusy, onBusy])
  useEffect(() => { if (questionRequest) setTab('chat') }, [questionRequest])

  const handleKeyChange = useCallback((e) => {
    setApiKey(e.target.value)
    localStorage.setItem(LS_KEY, e.target.value)
  }, [])

  const handleModelChange = useCallback((e) => {
    setModel(e.target.value)
    localStorage.setItem(LS_MODEL_KEY, e.target.value)
  }, [])

  return (
    <div className="explain-panel">
      <div className="explain-panel-header">
        <div className="explain-panel-title">
          <h2>AI アシスタント</h2>
        </div>
        <span className="explain-panel-badge">{MODELS.find(m => m.value === model)?.label ?? model}</span>
      </div>

      <div className="explain-panel-body">
        {/* APIキー・モデル（全タブ共通） */}
        <div className="explain-apikey-section">
          <label className="explain-apikey-label">OpenAI APIキー</label>
          <div className="explain-apikey-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={handleKeyChange}
              placeholder="sk-..."
              className="explain-apikey-input"
              spellCheck={false}
              autoComplete="off"
            />
            <button className="explain-apikey-toggle" onClick={() => setShowKey(v => !v)}>
              {showKey ? '非表示' : '表示'}
            </button>
          </div>
          <p className="explain-apikey-hint">ブラウザのlocalStorageに保存されます</p>

          <label className="explain-apikey-label" style={{ marginTop: 14, display: 'block' }}>モデル</label>
          <select value={model} onChange={handleModelChange} className="explain-model-select">
            {MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
            ))}
          </select>
        </div>

        {/* タブ切り替え */}
        <div className="assistant-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`assistant-tab ${tab === t.id ? 'assistant-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div hidden={tab !== 'explain'}><ExplainPanel results={results} apiKey={apiKey} model={model} ai={ai} onAiChange={onAiChange} onBusy={setExplainBusy} /></div>
        <div hidden={tab !== 'chat'}><AssistantChat results={results} apiKey={apiKey} model={model} questionRequest={questionRequest} chat={chat} onChatChange={onChatChange} onBusy={setChatBusy} /></div>
        {tab === 'knowledge' && <KnowledgeManager apiKey={apiKey} />}
        {tab === 'feedback' && <FeedbackLog />}
      </div>
    </div>
  )
}
