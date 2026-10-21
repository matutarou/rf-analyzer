import { useRef, useState } from 'react'
import axios from 'axios'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PyramidSheetPicker from './PyramidSheetPicker'
import { guessPyramidConfig, pyramidSeries } from '../populationPyramid'

export default function PopulationPyramid({ data, onChange, onBusyChange }) {
  const [cityName, setCityName] = useState('')
  const [source, setSource] = useState(null)
  const [config, setConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const city = data?.cities.find(item => item.name === cityName) || data?.cities[0]
  const { rows, total, limit, hasNegativeBands } = pyramidSeries(city, 'count')
  const action = async operation => {
    setBusy(true); onBusyChange(true); setError('')
    try { await operation() }
    catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : '人口ピラミッド用データを読み込めませんでした')
    } finally { setBusy(false); onBusyChange(false) }
  }
  const chooseFile = file => action(async () => {
    const form = new FormData()
    form.append('file', file)
    const response = await axios.post('/api/upload/sheets', form)
    const sheets = response.data.sheets
    const sheet = sheets.find(item => item.name.includes('人口ピラミッド')) || sheets.find(item => item.rows > 0 && item.columns.length >= 4)
    setSource({ file, sheets }); setConfig(guessPyramidConfig(sheet))
  })
  const load = () => action(async () => {
    const form = new FormData()
    form.append('file', source.file)
    form.append('pyramid_config', JSON.stringify(config))
    const response = await axios.post('/api/population-pyramid', form)
    onChange(response.data); setCityName(''); setSource(null)
  })
  return <section className="card">
    <div className="card-header"><h2>人口ピラミッド</h2>{data && <span className="badge">{data.cities.length}市町村・5歳階級</span>}</div>
    <div className="card-body">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => input.current?.click()}>{data ? '人口ピラミッド用Excelを変更' : '人口ピラミッド用Excelを追加'}</button>
      <input ref={input} type="file" accept=".xlsx" hidden disabled={busy} onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) chooseFile(file) }} />
      {busy && <p role="status">人口データを読み込んでいます...</p>}
      {error && <p role="alert" className="work-warning">{error}</p>}
      {data?.warnings?.map((warning, index) => <p key={index} className="work-warning">{warning}</p>)}
      {source && <div>
        <p>{source.file.name}</p>
        <PyramidSheetPicker sheets={source.sheets} config={config} onChange={setConfig} />
        <div className="btn-group"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setSource(null)}>キャンセル</button><button type="button" className="btn btn-primary" disabled={busy || !config} onClick={load}>人口ピラミッドを表示</button></div>
      </div>}
      {city ? <>
        <div className="pyramid-controls">
          <label>市町村 <select aria-label="人口ピラミッドの市町村" value={city.name} onChange={event => setCityName(event.target.value)}>{data.cities.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
        </div>
        <h3>{city.name}の人口ピラミッド</h3>
        <div className="pyramid-chart" role="img" aria-label={`${city.name}の人口ピラミッド。男性が左、女性が右。収録人口合計${total.toLocaleString()}人。`}>
          <ResponsiveContainer width="100%" height={520}>
            <BarChart data={rows} layout="vertical" stackOffset="sign" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[-limit, limit]} tickFormatter={value => Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 0 })} />
              <YAxis type="category" dataKey="age" width={78} interval={0} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, label) => [`${Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}人`, label]} />
              <Legend />
              <Bar dataKey="male" name="男性" fill="#2563eb" stackId="population" isAnimationActive={false} />
              <Bar dataKey="female" name="女性" fill="#dc4775" stackId="population" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {hasNegativeBands && <p className="work-warning">集計人口がマイナスの階級はグラフ上のみ0として表示します。人数表には実際の集計値を表示しています。</p>}
        <details><summary>人数の表を表示</summary><div className="work-scroll"><table className="work-table"><thead><tr><th>年齢階級</th><th>男性（人）</th><th>女性（人）</th></tr></thead><tbody>{[...city.bands].reverse().map(band => <tr key={band.age_start}><th>{band.age_start >= 100 ? '100歳以上' : `${band.age_start}〜${band.age_start + 4}歳`}</th><td>{band.male.toLocaleString()}</td><td>{band.female.toLocaleString()}</td></tr>)}</tbody></table></div></details>
      </> : <p>人口ピラミッド用データを読み込むと、市町村別のグラフを表示できます。</p>}
    </div>
  </section>
}
