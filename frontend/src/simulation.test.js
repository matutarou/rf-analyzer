import test from 'node:test'
import assert from 'node:assert/strict'
import { baselineFor, changeRate, signed, sortByShap } from './simulation.js'

test('変化率は変更前の絶対値を分母にし、0や数値でないときは計算しない', () => {
  assert.equal(changeRate(200, 250), 25)
  assert.equal(changeRate(-200, -100), 50)
  assert.equal(changeRate(0, 10), null)
  assert.equal(changeRate(null, 10), null)
  assert.equal(changeRate(10, NaN), null)
})

test('符号付きで表示し、数値でないときは「—」にする', () => {
  assert.equal(signed(1.234), '+1.23')
  assert.equal(signed(-4), '-4.00')
  assert.equal(signed(0), '0.00')
  assert.equal(signed(undefined), '—')
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
