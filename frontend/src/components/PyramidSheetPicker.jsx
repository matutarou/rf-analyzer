import { guessPyramidConfig } from '../populationPyramid'

export default function PyramidSheetPicker({ sheets, config, onChange }) {
  const sheet = sheets.find(item => item.name === config?.sheet_name)
  return <fieldset className="sheet-picker">
    <legend>人口ピラミッド用データ（可視化専用）</legend>
    <label>シート <select aria-label="人口ピラミッド用シート" value={config?.sheet_name || ''} onChange={event => onChange(guessPyramidConfig(sheets.find(item => item.name === event.target.value)))}>
      <option value="">使用しない</option>
      {sheets.map(item => <option key={item.name} value={item.name} disabled={!item.rows || item.columns.length < 4}>{item.name}</option>)}
    </select></label>
    {sheet && <>
      <div className="pyramid-columns">{[
        ['municipality_column', '市町村'], ['sex_column', '性別'], ['age_column', '年齢'], ['population_column', '人口'],
      ].map(([key, label]) => <label key={key}>{label}の列 <select aria-label={`人口ピラミッドの${label}列`} value={config[key]} onChange={event => onChange({ ...config, [key]: event.target.value })}>
        {sheet.columns.map(column => <option key={column} value={column}>{column}</option>)}
      </select></label>)}</div>
    </>}
  </fieldset>
}
