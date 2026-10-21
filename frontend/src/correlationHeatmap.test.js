import test from 'node:test'
import assert from 'node:assert/strict'
import { correlationColor } from './correlationHeatmap.js'

test('計算不可は灰色、相関0は白で表示する', () => {
  assert.equal(correlationColor(null), '#e5e7eb')
  assert.equal(correlationColor(NaN), '#e5e7eb')
  assert.equal(correlationColor(0), 'rgb(255, 255, 255)')
})

test('相関の符号で色が変わり、数値誤差で色の範囲を超えない', () => {
  assert.notEqual(correlationColor(-1), correlationColor(1))
  assert.equal(correlationColor(1.01), correlationColor(1))
  assert.equal(correlationColor(-1.01), correlationColor(-1))
})
