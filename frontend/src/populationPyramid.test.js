import test from 'node:test'
import assert from 'node:assert/strict'
import { comparedCities, guessPyramidConfig, pyramidSeries } from './populationPyramid.js'

test('人口ピラミッドの列名を推定し、見出しのない自治体列を使用できる', () => {
  assert.deepEqual(guessPyramidConfig({ name: '人口ピラミッド', columns: ['Unnamed: 0', '性別', '年齢層', '人口'] }), {
    sheet_name: '人口ピラミッド', municipality_column: 'Unnamed: 0', sex_column: '性別', age_column: '年齢層', population_column: '人口',
  })
  assert.equal(guessPyramidConfig(null), null)
})

test('男性を左、女性を右にし、高齢層を上に並べる', () => {
  const series = pyramidSeries({ bands: [{ age_start: 0, male: 10, female: 20 }, { age_start: 100, male: 5, female: 5 }] })
  assert.equal(series.total, 40)
  assert.deepEqual(series.rows, [{ age: '100歳以上', male: -5, female: 5 }, { age: '0〜4歳', male: -10, female: 20 }])
  assert.ok(series.limit > 20)
})

test('構成比は市町村の男女合計を分母にする', () => {
  const series = pyramidSeries({ bands: [{ age_start: 0, male: 10, female: 30 }] }, 'percent')
  assert.equal(series.rows[0].male, -25)
  assert.equal(series.rows[0].female, 75)
})

test('人口0の市町村でも無限値を作らない', () => {
  const series = pyramidSeries({ bands: [{ age_start: 0, male: 0, female: 0 }] }, 'percent')
  assert.ok(series.rows.every(row => Number.isFinite(row.male) && Number.isFinite(row.female)))
  assert.ok(series.limit > 0)
})

test('負の階級はグラフのみ0とし、実際の人数と合計を保持する', () => {
  const city = { bands: [{ age_start: 0, male: 10, female: 20 }, { age_start: 95, male: -3, female: -2 }] }
  const series = pyramidSeries(city)
  assert.equal(series.total, 25)
  assert.equal(series.hasNegativeBands, true)
  assert.deepEqual(series.rows, [{ age: '95〜99歳', male: -0, female: 0 }, { age: '0〜4歳', male: -10, female: 20 }])
  assert.deepEqual(city.bands[1], { age_start: 95, male: -3, female: -2 })
  const percent = pyramidSeries(city, 'percent')
  assert.deepEqual(percent.rows, [{ age: '95〜99歳', male: -0, female: 0 }, { age: '0〜4歳', male: -40, female: 80 }])
})

test('負の階級がなければグラフの補正注記を表示しない', () => {
  assert.equal(pyramidSeries({ bands: [{ age_start: 0, male: 0, female: 1 }] }).hasNegativeBands, false)
  assert.equal(pyramidSeries(null).hasNegativeBands, false)
})

test('負の階級で合計が0や負になってもグラフの左右を維持する', () => {
  for (const female of [-10, -20]) {
    const series = pyramidSeries({ bands: [{ age_start: 0, male: 10, female }] }, 'percent')
    assert.equal(series.total, 10 + female)
    assert.ok(series.rows.every(row => Number.isFinite(row.male) && row.male <= 0 && Number.isFinite(row.female) && row.female >= 0))
    assert.ok(series.limit > 0)
  }
})

test('比較する市町村は存在するものを重複なく最大4つ選び、未選択なら先頭を表示する', () => {
  const cities = ['水戸市', '日立市', '土浦市', '古河市', '石岡市'].map(name => ({ name, bands: [] }))
  const names = list => comparedCities(cities, list).map(city => city.name)
  assert.deepEqual(names(['土浦市', '', '水戸市']), ['土浦市', '水戸市'])
  assert.deepEqual(names(['日立市', '日立市', '不明市']), ['日立市'])
  assert.deepEqual(names(['石岡市', '古河市', '土浦市', '日立市', '水戸市']), ['石岡市', '古河市', '土浦市', '日立市'])
  assert.deepEqual(names(['', '']), ['水戸市'])
  assert.deepEqual(comparedCities([], ['水戸市']), [])
})
