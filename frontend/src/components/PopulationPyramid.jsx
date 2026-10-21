import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MAX_COMPARED_CITIES, comparedCities, pyramidSeries } from '../populationPyramid'

const formatCount = value => Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 0 })

// 1市町村分の人口ピラミッド（横軸は市町村ごとの人数に合わせる）
function CityPyramid({ city }) {
  const { rows, total, limit } = pyramidSeries(city, 'count')
  return <div className="pyramid-item">
    <h3>{city.name}</h3>
    <div className="pyramid-chart" role="img" aria-label={`${city.name}の人口ピラミッド。男性が左、女性が右。収録人口合計${total.toLocaleString()}人。`}>
      <ResponsiveContainer width="100%" height={460}>
        <BarChart data={rows} layout="vertical" stackOffset="sign" margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" domain={[-limit, limit]} tickFormatter={formatCount} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="age" width={70} interval={0} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value, label) => [`${formatCount(value)}人`, label]} />
          <Legend />
          <Bar dataKey="male" name="男性" fill="#2563eb" stackId="population" isAnimationActive={false} />
          <Bar dataKey="female" name="女性" fill="#dc4775" stackId="population" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <details><summary>人数の表を表示</summary><div className="work-scroll"><table className="work-table"><thead><tr><th>年齢階級</th><th>男性（人）</th><th>女性（人）</th></tr></thead><tbody>{[...city.bands].reverse().map(band => <tr key={band.age_start}><th>{band.age_start >= 100 ? '100歳以上' : `${band.age_start}〜${band.age_start + 4}歳`}</th><td>{band.male.toLocaleString()}</td><td>{band.female.toLocaleString()}</td></tr>)}</tbody></table></div></details>
  </div>
}

// 学習データと一緒に読み込んだ人口ピラミッドを、最大4市町村まで並べて表示する（データがなければ何も表示しない）
export default function PopulationPyramid({ data }) {
  const [names, setNames] = useState([])
  const cities = data?.cities || []
  const shown = comparedCities(cities, names)
  if (!shown.length) return null
  // 未選択のときは先頭の市町村を1つ目の欄に表示する
  const slots = Array.from({ length: MAX_COMPARED_CITIES }, (_, index) => names[index] || '')
  if (slots.every(name => !cities.some(city => city.name === name))) slots.splice(0, MAX_COMPARED_CITIES, shown[0].name, '', '', '')
  const choose = (index, name) => setNames(slots.map((value, slot) => slot === index ? name : value))
  return <section className="card">
    <div className="card-header"><h2>人口ピラミッド</h2><span className="badge">{cities.length}市町村・5歳階級</span></div>
    <div className="card-body">
      <div className="pyramid-controls">
        {slots.map((value, index) => <label key={index}>市町村{index + 1} <select aria-label={`人口ピラミッドの市町村${index + 1}`} value={value} onChange={event => choose(index, event.target.value)}>
          <option value="">—</option>
          {cities.map(item => <option key={item.name} value={item.name} disabled={item.name !== value && slots.includes(item.name)}>{item.name}</option>)}
        </select></label>)}
      </div>
      <div className="pyramid-compare">{shown.map(city => <CityPyramid key={city.name} city={city} />)}</div>
    </div>
  </section>
}
