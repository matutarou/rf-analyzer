import { useState, useCallback, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react'
import axios from 'axios'
import FileUpload from './components/FileUpload'
import DataPreview from './components/DataPreview'
import ColumnSelector from './components/ColumnSelector'
import HyperParams from './components/HyperParams'
import Results from './components/Results'
import PredictForm from './components/PredictForm'
import TestPredict from './components/TestPredict'
import AssistantPanel from './components/AssistantPanel'
import WorkspacePanel, { IconButton } from './components/WorkspacePanel'
import DataDiagnostics from './components/DataDiagnostics'
import PopulationPyramid from './components/PopulationPyramid'
import AnalysisHistory from './components/AnalysisHistory'
import { WorkspaceWriter } from './workspaceWriter'
import { isBlankWorkspace } from './isBlankWorkspace'
import { readAssistantHidden, writeAssistantHidden } from './assistantVisibility'
import { MessageCircleQuestion, PanelRightClose, PanelRightOpen } from 'lucide-react'
import './workspace.css'

const API_BASE = '/api'

export default function App() { return <AnalysisHistory Workspace={AnalysisWorkspace} /> }

const AnalysisWorkspace = forwardRef(function AnalysisWorkspace({ initial, onOpen, onNew, onSaved }, ref) {
  const state = initial.state
  const [name, setName] = useState(state.name || '新しい分析')
  const [fileInfo, setFileInfo] = useState(initial.file_info)
  const [populationPyramid, setPopulationPyramid] = useState(state.population_pyramid || null)
  const [pyramidBusy, setPyramidBusy] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState(state.target || '')
  const [selectedFeatures, setSelectedFeatures] = useState(state.features || [])
  const [hyperParams, setHyperParams] = useState({
    optimize: true,
    n_trials: 50,
    optimize_metric: 'r2',
    shap_top_n: 10,
    importance_top_n: 10,
    ...state.params,
  })
  const [results, setResults] = useState(state.results || null)
  const [trainedParams, setTrainedParams] = useState(initial.model_status?.available ? state.trained_params : null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)
  const [ai, setAi] = useState(state.ai || { explanations: [], summary: '' })
  const [chat, setChat] = useState(state.chat || { messages: [], input: '', screen_context: '' })
  const [assistantTab, setAssistantTab] = useState(state.view?.assistant_tab || 'explain')
  const [assistantHidden, setAssistantHidden] = useState(() => readAssistantHidden())
  useEffect(() => { writeAssistantHidden(assistantHidden) }, [assistantHidden])
  const [aiBusy, setAiBusy] = useState(false)
  const [scroll, setScroll] = useState({ left_scroll: state.view?.left_scroll || 0, right_scroll: state.view?.right_scroll || 0 })
  const [saveStatus, setSaveStatus] = useState('pending')
  const [saveError, setSaveError] = useState('')
  const leftPanel = useRef(null)
  const rightPanel = useRef(null)
  const [questionRequest, setQuestionRequest] = useState(null)
  const ask = (question, context = '') => {
    setAssistantHidden(false)
    setAssistantTab('chat')
    setQuestionRequest({ question, context, id: Date.now() })
  }
  useEffect(() => {
    if (questionRequest) rightPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [questionRequest])

  const paramsRef = useRef(null)

  // 分割パネルのドラッグ状態
  const [leftPct, setLeftPct] = useState(state.view?.left_pct || 65)
  const containerRef = useRef(null)
  const dragging = useRef(false)

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(Math.max(pct, 30), 80))
    }
    const onMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const onDividerMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const scrollTo = (ref) => {
    setTimeout(() => ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const handleUpload = useCallback(async (file, options = {}) => {
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (options.sheetNames) {
        formData.append('sheet_names', JSON.stringify(options.sheetNames))
        formData.append('join_keys', JSON.stringify(options.joinKeys))
      }
      if (options.pyramidConfig) formData.append('pyramid_config', JSON.stringify(options.pyramidConfig))
      const res = await axios.post(`${API_BASE}/upload`, formData)
      setFileInfo(res.data)
      setPopulationPyramid(res.data.population_pyramid || null)
      if (name === '新しい分析') setName(file.name.slice(0, 150))
      const names = new Set(res.data.columns.map(c => c.name))
      setSelectedTarget(value => names.has(value) ? value : '')
      setSelectedFeatures(value => value.filter(c => names.has(c)))
      setResults(null)
      setTrainedParams(null)
      setAi({ explanations: [], summary: '' })
      setQuestionRequest(null)
      setChat(value => ({ ...value, screen_context: '' }))
      return true
    } catch (err) {
      const d = err.response?.data?.detail
      setError(Array.isArray(d) ? d.map(e => e.msg).join(' / ') : (d || 'アップロードに失敗しました'))
      return false
    } finally {
      setLoading(false)
    }
  }, [name])

  const handleColumnSelect = useCallback((target, features) => {
    if (target === selectedTarget && JSON.stringify(features) === JSON.stringify(selectedFeatures)) return
    setSelectedTarget(target)
    setSelectedFeatures(features)
    setResults(null)
    setTrainedParams(null)
    setAi({ explanations: [], summary: '' })
    setQuestionRequest(null)
    setChat(value => ({ ...value, screen_context: '' }))
  }, [selectedTarget, selectedFeatures])

  const handleAnalyze = useCallback(async (params) => {
    if (loading || !fileInfo || !selectedTarget || selectedFeatures.length === 0) return
    setHyperParams(params)
    setLoading(true)
    setError('')
    try {
      const started = await axios.post(`${API_BASE}/analysis-jobs`, {
        file_id: fileInfo.file_id,
        target_column: selectedTarget,
        feature_columns: selectedFeatures,
        ...params,
      })
      setAnalysisJob(started.data.job_id)
      let res
      for (;;) {
        const poll = await axios.get(`${API_BASE}/analysis-jobs/${started.data.job_id}`)
        setAnalysisProgress(poll.data.progress || '')
        if (poll.data.status === 'completed') { res = { data: poll.data.result }; break }
        if (poll.data.status === 'cancelled') return
        if (poll.data.status === 'failed') throw new Error(poll.data.error)
        await new Promise(resolve => setTimeout(resolve, 700))
      }
      setResults(res.data)
      setAi({ explanations: [], summary: '' })
      setQuestionRequest(null)
      setChat(value => ({ ...value, screen_context: '' }))
      setTrainedParams(res.data.trained_params ?? res.data.best_params ?? {
        n_estimators: params.n_estimators ?? 100,
        max_depth: params.max_depth ?? null,
        min_samples_split: params.min_samples_split ?? 2,
        min_samples_leaf: params.min_samples_leaf ?? 1,
        max_features: null,
        random_state: 77,
      })
    } catch (err) {
      const d = err.response?.data?.detail
      setError(Array.isArray(d) ? d.map(e => e.msg).join(' / ') : (d || err.message || '分析中にエラーが発生しました'))
    } finally {
      setAnalysisJob(null)
      setAnalysisProgress('')
      setLoading(false)
    }
  }, [fileInfo, selectedTarget, selectedFeatures, loading])

  const [analysisJob, setAnalysisJob] = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState('')
  const cancelAnalysis = async () => {
    try {
      await axios.delete(`${API_BASE}/analysis-jobs/${analysisJob}`)
      setAnalysisProgress('現在の学習処理が終了したら停止します')
    } catch { setError('キャンセルの要求に失敗しました') }
  }

  const snapshot = { file_id: fileInfo?.file_id || null, name: name.trim() || '新しい分析', filename: fileInfo?.filename || '', target: selectedTarget,
    features: selectedFeatures, params: hyperParams, results, ai, chat, data_mode: 'single', population_pyramid: populationPyramid,
    view: { assistant_tab: assistantTab, left_pct: leftPct, ...scroll } }
  const savedCallback = useRef(onSaved)
  savedCallback.current = onSaved
  const writer = useRef(null)
  if (!writer.current) writer.current = new WorkspaceWriter(
    async payload => (await axios.put(`/api/projects/${initial.id}`, payload)).data,
    initial.version,
    (status, e) => {
      setSaveStatus(status)
      setSaveError(e ? (e.response?.data?.detail || '自動保存に失敗しました。再試行してください。') : '')
      if (status === 'saved') { setHistoryRevision(v => v + 1); savedCallback.current() }
    },
  )
  const blank = isBlankWorkspace(snapshot, writer.current.version)
  const serialized = JSON.stringify(snapshot)
  useLayoutEffect(() => { writer.current.update(JSON.parse(serialized)) }, [serialized])
  useEffect(() => {
    setSaveStatus(blank ? 'new' : 'pending')
    if (blank) { setSaveError(''); return }
    const timer = setTimeout(() => writer.current.flush().catch(() => {}), 600)
    return () => clearTimeout(timer)
  }, [serialized, blank])
  useEffect(() => {
    const warn = event => { if (writer.current.dirty || loading || aiBusy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [loading, aiBusy])
  useLayoutEffect(() => {
    if (leftPanel.current) leftPanel.current.scrollTop = state.view?.left_scroll || 0
    if (rightPanel.current) rightPanel.current.scrollTop = state.view?.right_scroll || 0
  }, [])
  useImperativeHandle(ref, () => ({ flush: async () => {
    if (loading || aiBusy || pyramidBusy) throw new Error('分析・AI回答の生成・データ読込が完了してから切り替えてください。')
    await writer.current.flush()
  } }), [loading, aiBusy, pyramidBusy])

  return (
    <div className="page">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div>
              <h1>自治体データ分析</h1>
              <p className="header-sub">Random Forest 回帰分析ツール</p>
            </div>
          </div>
          <div className="workspace-title"><input aria-label="分析名" value={name} maxLength={150} onChange={e => setName(e.target.value)} /><span role="status">{blank ? '新規' : {new: '新規', pending: '未保存', saving: '保存中...', saved: '保存済み', error: '保存失敗'}[saveStatus]}</span></div>
          <button type="button" className="work-icon" aria-expanded={!assistantHidden} aria-controls="assistant-panel" onClick={() => setAssistantHidden(value => !value)}>
            {assistantHidden ? <PanelRightOpen size={18} aria-hidden="true" /> : <PanelRightClose size={18} aria-hidden="true" />}
            {assistantHidden ? 'AIアシスタントを表示' : 'AIアシスタントを隠す'}
          </button>
          {fileInfo && (
            <button className="btn-reset" onClick={onNew} disabled={loading || aiBusy || pyramidBusy}>
              新規分析
            </button>
          )}
        </div>
      </header>
      {saveError && <div className="work-warning" role="alert">{saveError}<button onClick={() => writer.current.flush().catch(() => {})}>再試行</button></div>}
      {analysisJob && <div role="status" style={{ padding: 16, overflowWrap: 'anywhere' }}>
        {analysisProgress || '分析を開始中'}
        <button type="button" onClick={cancelAnalysis} style={{ marginLeft: 16 }}>キャンセル</button>
      </div>}

      <div className="split-container" ref={containerRef}>
        {/* 左パネル: 既存の分析UI */}
        <div className="split-left" ref={leftPanel} onScroll={e => { const top = e.currentTarget.scrollTop; setScroll(value => ({ ...value, left_scroll: top })) }} style={{ width: assistantHidden ? '100%' : `${leftPct}%` }}>
          <nav className="section-nav">
            {[
              { id: 'sec-upload',   label: '学習データ' },
              { id: 'sec-preview',  label: 'プレビュー' },
              { id: 'sec-pyramid', label: '人口ピラミッド' },
              { id: 'sec-quality', label: '変数間の相関' },
              { id: 'sec-history', label: '保存・比較' },
              { id: 'sec-columns',  label: 'カラム選択' },
              { id: 'sec-params',   label: 'パラメータ' },
              { id: 'sec-results',  label: '分析結果' },
              { id: 'sec-simulate', label: 'シミュレーション' },
              { id: 'sec-test',     label: 'テスト予測' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className="section-nav-item"
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {label}
              </button>
            ))}
          </nav>

          <main className="main">
            {error && (
              <div className="error-banner">
                <p>{error}</p>
                <button onClick={() => setError('')}>×</button>
              </div>
            )}

            {loading && !analysisJob && (
              <div className="loading-overlay">
                <div className="spinner" />
                <p>処理中...</p>
              </div>
            )}

            <fieldset disabled={loading || pyramidBusy} className="analysis-fields">
            <div id="sec-upload">
              <FileUpload onUpload={handleUpload} fileInfo={fileInfo} />
            </div>
            <div id="sec-preview"><DataPreview data={fileInfo} /></div>
            <div id="sec-pyramid"><PopulationPyramid data={populationPyramid} onChange={setPopulationPyramid} onBusyChange={setPyramidBusy} /></div>
            <div id="sec-columns">
              <ColumnSelector
                key={fileInfo?.file_id || 'empty'}
                initialTarget={selectedTarget}
                initialFeatures={selectedFeatures}
                columns={fileInfo?.columns ?? []}
                onSelect={handleColumnSelect}
                onProceed={() => scrollTo(paramsRef)}
              />
            </div>
            <div id="sec-quality"><DataDiagnostics fileId={fileInfo?.file_id} target={selectedTarget} features={selectedFeatures} onAsk={ask} /></div>

            <div id="sec-params" ref={paramsRef}>
              <HyperParams
                key={fileInfo?.file_id || 'empty'}
                defaultParams={hyperParams}
                onChange={value => { setHyperParams(value); setResults(null); setTrainedParams(null); setAi({ explanations: [], summary: '' }); setQuestionRequest(null); setChat(c => ({ ...c, screen_context: '' })) }}
                onSubmit={handleAnalyze}
                dataRows={fileInfo?.rows}
                featureCount={selectedFeatures.length || (fileInfo?.columns.length ?? 2) - 1}
                canAnalyze={!!(fileInfo && !loading && selectedTarget && selectedFeatures.length > 0)}
              />
            </div>

            <div id="sec-results"><div className="work-toolbar">{['R²', '特徴量重要度', 'SHAP'].map(topic => <IconButton key={topic} title={`${topic}について質問`} onClick={() => ask(`現在の分析結果の${topic}を説明してください。`, `選択した表示: ${topic}`)}><MessageCircleQuestion size={16} /><span>{topic}</span></IconButton>)}</div><Results results={results} /></div>

            <div id="sec-simulate">
              {results && !trainedParams && initial.model_status?.reason && <p className="work-warning" role="status">{initial.model_status.reason}</p>}
              <PredictForm
                modelId={results?.model_id}
                fileInfo={fileInfo}
                selectedTarget={selectedTarget}
                selectedFeatures={selectedFeatures}
                hyperParams={trainedParams}
              />
            </div>

            <div id="sec-test">
              <TestPredict
                key={fileInfo?.file_id || 'empty'}
                dataMode="single"
                fileInfo={fileInfo}
                selectedTarget={selectedTarget}
                selectedFeatures={selectedFeatures}
                hyperParams={trainedParams}
              />
            </div>
            </fieldset>
            <div id="sec-history"><WorkspacePanel snapshot={snapshot} onOpen={onOpen} onSave={() => writer.current.flush()} revision={historyRevision} busy={loading || aiBusy} /></div>
          </main>

          <footer className="footer">
            <p>Random Forest Regression Analyzer — scikit-learn + FastAPI + React</p>
          </footer>
        </div>

        {/* ドラッグ可能な縦スライダー */}
        <div className="split-divider" hidden={assistantHidden} onMouseDown={onDividerMouseDown}>
          <div className="split-divider-handle" />
        </div>

        {/* 右パネル: AIアシスタント（解説/チャット/知識ベース） */}
        <div id="assistant-panel" hidden={assistantHidden} ref={rightPanel} onScroll={e => { const top = e.currentTarget.scrollTop; setScroll(value => ({ ...value, right_scroll: top })) }} className="split-right" style={{ width: `${100 - leftPct}%` }}>
          <AssistantPanel results={results} ai={ai} onAiChange={setAi} questionRequest={questionRequest} chat={chat} onChatChange={setChat} tab={assistantTab} setTab={setAssistantTab} onBusy={setAiBusy} />
        </div>
      </div>
    </div>
  )
})
