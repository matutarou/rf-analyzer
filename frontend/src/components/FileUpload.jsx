import { useState, useRef } from 'react'
import axios from 'axios'
import PyramidSheetPicker from './PyramidSheetPicker'
import { defaultWorkbookSelection, isFactorSheet, shouldAutoImport } from '../workbookSelection'

export default function FileUpload({ onUpload, fileInfo }) {
  const [dragOver, setDragOver] = useState(false)
  const [workbook, setWorkbook] = useState(null)
  const [selected, setSelected] = useState([])
  const [baseSheet, setBaseSheet] = useState('')
  const [joinKeys, setJoinKeys] = useState({})
  const [inspecting, setInspecting] = useState(false)
  const [error, setError] = useState('')
  const [pyramidConfig, setPyramidConfig] = useState(null)
  const inputRef = useRef(null)

  const chooseFile = async (file) => {
    if (inspecting) return
    setError(''); setWorkbook(null)
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      await onUpload(file)
      return
    }
    setInspecting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post('/api/upload/sheets', form)
      const defaults = defaultWorkbookSelection(data.sheets)
      const keys = Object.fromEntries(data.sheets.map(sheet => [sheet.name, sheet.columns[0] || '']))
      // 既定のシートがそろっていれば選択画面を出さずに読み込み、失敗したときだけ選択画面を表示する
      if (shouldAutoImport(defaults) && await onUpload(file, { sheetNames: defaults.sheetNames, joinKeys: keys, pyramidConfig: defaults.pyramidConfig })) return
      setWorkbook({ file, sheets: data.sheets })
      setSelected(defaults.sheetNames)
      setBaseSheet(defaults.sheetNames[0] || '')
      setJoinKeys(keys)
      setPyramidConfig(defaults.pyramidConfig)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Excelのシート一覧を取得できませんでした')
    } finally { setInspecting(false) }
  }

  const toggleSheet = (name) => {
    const next = selected.includes(name) ? selected.filter(value => value !== name) : [...selected, name]
    setSelected(next)
    if (!next.includes(baseSheet)) setBaseSheet(next[0] || '')
  }

  const importSheets = async () => {
    if (!selected.length) return
    const sheetNames = [baseSheet, ...selected.filter(name => name !== baseSheet)]
    const success = await onUpload(workbook.file, { sheetNames, joinKeys, pyramidConfig })
    if (success) setWorkbook(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) chooseFile(file)
  }

  const handleChange = (e) => {
    const file = e.target.files[0]
    if (file) chooseFile(file)
    e.target.value = ''
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <h2>学習データ</h2>
        {fileInfo && (
          <span className="badge">{fileInfo.rows.toLocaleString()} 行 × {fileInfo.columns.length} 列</span>
        )}
      </div>
      <div className="card-body" style={{ padding: '16px 24px' }}>
        {fileInfo ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{fileInfo.filename}</div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => inputRef.current?.click()}
              disabled={inspecting}
            >
              ファイルを変更
            </button>
          </div>
        ) : (
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            style={{ padding: '40px 24px', margin: 0 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <h3>学習データをアップロード</h3>
            <p>ファイルをドラッグ＆ドロップ，またはクリックして選択</p>
            <p className="formats">対応形式: CSV (.csv) / TSV (.tsv) / Excel (.xlsx)</p>
          </div>
        )}
        {inspecting && <p role="status">Excelのシートを確認しています...</p>}
        {error && <p className="work-warning" role="alert">{error}</p>}
        {workbook && <fieldset disabled={inspecting} className="sheet-picker">
          <legend>Excelシートの選択</legend>
          <p>{workbook.file.name}</p>
          <p>1シートだけ読み込むか、複数シートを共通のキーで横結合できます。</p>
          <p>「人口関係データ」と「想定される要因（原因）」がある場合は、両方を初期選択します。市町村名などの結合キーを確認して読み込むと、結合したデータをプレビューできます。説明変数は「想定される要因（原因）」から選択し、「人口ピラミッド」は可視化専用です。</p>
          <div className="work-scroll"><table className="work-table">
            <thead><tr><th>使用</th><th>シート</th><th>行 × 列</th>{selected.length > 1 && <th>結合キー</th>}</tr></thead>
            <tbody>{workbook.sheets.map(sheet => <tr key={sheet.name}>
              <td><input type="checkbox" aria-label={`${sheet.name}を読み込む`} checked={selected.includes(sheet.name)} disabled={!sheet.rows || !sheet.columns.length || pyramidConfig?.sheet_name === sheet.name} onChange={() => toggleSheet(sheet.name)} /></td>
              <td>{sheet.name}{pyramidConfig?.sheet_name === sheet.name ? '（可視化専用）' : isFactorSheet(sheet.name) ? '（説明変数候補）' : ''}</td><td>{sheet.rows.toLocaleString()} × {sheet.columns.length}</td>
              {selected.length > 1 && <td>{selected.includes(sheet.name) && <select aria-label={`${sheet.name}の結合キー`} value={joinKeys[sheet.name]} onChange={event => setJoinKeys(value => ({ ...value, [sheet.name]: event.target.value }))}>
                {sheet.columns.map(column => <option key={column} value={column}>{column}</option>)}
              </select>}</td>}
            </tr>)}</tbody>
          </table></div>
          <PyramidSheetPicker sheets={workbook.sheets} config={pyramidConfig} onChange={config => {
            setPyramidConfig(config)
            const next = selected.filter(name => name !== config?.sheet_name)
            setSelected(next)
            if (!next.includes(baseSheet)) setBaseSheet(next[0] || '')
          }} />
          {selected.length > 1 && <>
            <label>基準シート <select aria-label="基準シート" value={baseSheet} onChange={event => setBaseSheet(event.target.value)}>
              {selected.map(name => <option key={name} value={name}>{name}</option>)}
            </select></label>
            <p>基準シートの行を維持して結合します。追加列にはシート名が付きます。キーは各シートで空欄・重複がない列を選んでください。一致しない行の追加列は欠損値になります。</p>
          </>}
          <div className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={() => setWorkbook(null)}>キャンセル</button>
            <button type="button" className="btn btn-primary" disabled={!selected.length} onClick={importSheets}>{selected.length > 1 ? '選択したシートを結合して読み込む' : '選択したシートを読み込む'}</button>
          </div>
        </fieldset>}
        {!workbook && fileInfo?.selected_sheets?.length > 0 && <p>読み込み済みシート: {fileInfo.selected_sheets.join('、')}</p>}
        {fileInfo?.warnings?.map(message => <p className="work-warning" role="status" key={message}>{message}</p>)}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.xlsx"
          disabled={inspecting}
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
