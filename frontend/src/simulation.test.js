import test from 'node:test'
import assert from 'node:assert/strict'
import { baselineFor, formatValue, signed, sliderStep, sortByRowShap, sortByShap } from './simulation.js'

test('1000以上は整数、小さい値は有効数字4桁で表示し、符号も付ける', () => {
  assert.equal(formatValue(269231.4), '269,231')
  assert.equal(formatValue(-0.0019734), '-0.001973')
  assert.equal(formatValue(12.3456), '12.35')
  assert.equal(formatValue(0), '0')
  assert.equal(formatValue(NaN), '—')
  assert.equal(signed(0.0012345), '+0.001235')
  assert.equal(signed(-4), '-4')
  assert.equal(signed(0), '0')
  assert.equal(signed(undefined), '—')
})

test('スライダーの刻みは範囲のおよそ1/100で、整数の列は1より細かくしない', () => {
  assert.equal(sliderStep(-0.01, 0.01), 0.0001)
  assert.equal(sliderStep(3000, 5000), 10)
  assert.equal(sliderStep(0, 8), 0.01)
  assert.equal(sliderStep(0, 8, true), 1)
  assert.equal(sliderStep(5, 5), 1)
})

test('変数はSHAPの大きい順に並べ、SHAPにない変数は元の順で後ろに置く', () => {
  const shap = [{ feature: 'c', mean_abs_shap: 3 }, { feature: 'a', mean_abs_shap: 2 }]
  assert.deepEqual(sortByShap(['a', 'b', 'c', 'd'], shap), ['c', 'a', 'b', 'd'])
  assert.deepEqual(sortByShap(['a', 'b'], undefined), ['a', 'b'])
  assert.deepEqual(sortByShap([], shap), [])
})

test('基準値は市町村の値を使い、行がない・値が欠けているときは平均値で補う', () => {
  const means = { a: 1.5, b: 10 }
  assert.deepEqual(baselineFor(['a', 'b'], means, { a: 3, b: 20, 茨城県: '水戸市' }), { a: 3, b: 20 })
  assert.deepEqual(baselineFor(['a', 'b'], means, { a: null, b: 20 }), { a: 1.5, b: 20 })
  assert.deepEqual(baselineFor(['a', 'b'], means, null), means)
})

test('選んだ市町村のSHAP絶対値の大きい順に並べ、その行のSHAPがなければnullを返す', () => {
  const shap = { features: ['a', 'b', 'c'], rows: [0, 2, 3], values: [[0.1, -0.5, 0.2], [0.3, 0.1, -0.2], [0, 0, 0]] }
  assert.deepEqual(sortByRowShap(['a', 'b', 'c'], shap, 0), ['b', 'c', 'a'])
  assert.deepEqual(sortByRowShap(['a', 'b', 'c'], shap, 2), ['a', 'c', 'b'])
  assert.deepEqual(sortByRowShap(['c', 'a', 'd'], shap, 2), ['a', 'c', 'd'])
  assert.equal(sortByRowShap(['a'], shap, 1), null)
  assert.equal(sortByRowShap(['a'], { importance: [] }, 0), null)
  assert.equal(sortByRowShap(['a'], undefined, 0), null)
})
