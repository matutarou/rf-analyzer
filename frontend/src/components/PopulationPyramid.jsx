import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { pyramidSeries } from '../populationPyramid'

// 学習データと一緒に読み込んだ人口ピラミッドを表示する（データがなければ何も表示しない）
export default function PopulationPyramid({ data }) {
  const [cityName, setCityName] = useState('')
  const city = data?.cities.find(item => item.name === cityName) || data?.cities[0]
  const { rows, total, limit } = pyramidSeries(city, 'count')
  if (!city) return null
  return <section className="card">
    <div className="card-header"><h2>人口ピラミッド</h2><span className="badge">{data.cities.length}市町村・5歳階級</span></div>
    <div className="card-body">
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
        <details><summary>人数の表を表示</summary><div className="work-scroll"><table className="work-table"><thead><tr><th>年齢階級</th><th>男性（人）</th><th>女性（人）</th></tr></thead><tbody>{[...city.bands].reverse().map(band => <tr key={band.age_start}><th>{band.age_start >= 100 ? '100歳以上' : `${band.age_start}〜${band.age_start + 4}歳`}</th><td>{band.male.toLocaleString()}</td><td>{band.female.toLocaleString()}</td></tr>)}</tbody></table></div></details>
    </div>
  </section>
}
