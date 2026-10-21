import test from 'node:test'
import assert from 'node:assert/strict'
import { changeRate, signed } from './simulation.js'

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
