import { useState, useCallback, useEffect, useRef } from 'react'
import axios from 'axios'
import AnswerFeedback from './AnswerFeedback'

// 役割ごとの表示色（賛成=緑系、中立=青系、反対=赤系）
const ROLE_STYLES = {
  '賛成': 'role-card--pro',
  '中立': 'role-card--neutral',
  '反対': 'role-card--con',
}

// 結果解説タブ。賛成・中立・反対の3視点で並列に解説を生成する。
export default function ExplainPanel({ results, apiKey, model, ai, onAiChange, onBusy }) {
  const explanations = ai.explanations || []
  const [summarizing, setSummarizing] = useState(false)
  const generation = useRef(0)
  useEffect(() => { generation.current += 1; setError(''); return () => { generation.current += 1 } }, [results])
  const [explaining, setExplaining] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { onBusy(explaining || summarizing) }, [explaining, summarizing, onBusy])

  const handleExplain = useCallback(async () => {
    if (!results) return
    const version = generation.current
    if (!apiKey.trim()) {
      setError('OpenAI APIキーを入力してください。')
      return
    }
    setExplaining(true)
    onAiChange({ explanations: [], summary: '' })
    setError('')
    try {
      const { metrics, feature_importance, shap, data_info, best_params, residual_stats } = results
      const res = await axios.post('/api/explain/roles', {
        api_key: apiKey.trim(),
        model,
        roles: ['賛成', '中立', '反対'],
        metrics,
        feature_importance,
        shap_importance: shap?.importance ?? [],
        data_info,
        best_params,
        residual_stats,
      })
      if (version === generation.current) onAiChange({ explanations: res.data.explanations, summary: '', model })
    } catch (err) {
      const d = err.response?.data?.detail
      setError(d || 'AI解説の生成に失敗しました')
    } finally {
      setExplaining(false)
    }
  }, [results, apiKey, model, onAiChange])

  const summarize = async () => {
    const version = generation.current
    setSummarizing(true); setError('')
    try {
      const response = await axios.post('/api/explain/synthesis', { api_key: apiKey.trim(), model, results, explanations })
      if (version === generation.current) onAiChange({ ...ai, summary: response.data.summary })
    } catch { setError('共通点・相違点の整理に失敗しました') }
    finally { setSummarizing(false) }
  }

  if (!results) {
    return (
      <div className="explain-placeholder">
        <p>分析を実行すると<br />AI解説が利用可能になります</p>
      </div>
    )
  }

  return (
    <div className="explain-content">
      <p className="explain-description">
        分析結果を<strong>賛成・中立・反対</strong>の<br />
        3つの視点から解説します。
      </p>
      <button
        onClick={handleExplain}
        disabled={explaining || summarizing}
        className={`btn-explain ${explaining ? 'btn-explain--loading' : ''}`}
      >
        {explaining ? (<><span className="btn-explain-spinner" />生成中...</>) : '3視点で解説を生成'}
      </button>

      {error && <div className="explain-error">{error}</div>}

      {explanations.map((ex) => (
        <div key={ex.role} className={`role-card ${ROLE_STYLES[ex.role] ?? ''}`}>
          <div className="role-card-label">{ex.label}</div>
          <div className="role-card-text">{ex.content}</div>
          <AnswerFeedback answer={ex.content} question={`${ex.role}の分析解説`} model={ai.model || model} />
        </div>
      ))}
      {explanations.length === 3 && <button className="btn-explain" disabled={summarizing || explaining || !apiKey.trim()} onClick={summarize}>{summarizing ? '整理中...' : '共通点・相違点を整理'}</button>}
      {ai.summary && <section className="synthesis"><h3>共通点・相違点・未確認事項</h3><p>{ai.summary}</p><AnswerFeedback answer={ai.summary} question="3視点の整理" model={ai.model || model} /></section>}
    </div>
  )
}
