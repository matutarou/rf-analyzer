import test from 'node:test'
import assert from 'node:assert/strict'
import { HISTORY_HIDDEN_KEY, historyDomain, readHistoryHidden, writeHistoryHidden } from './optunaHistory.js'

test('推移グラフの縦軸は試行のR²を含み、極端に悪い試行は最良値の1.0下で切る', () => {
  assert.deepEqual(historyDomain([{ value: 0.4, best: 0.4 }, { value: 0.6, best: 0.6 }]), [0.39, 0.61])
  const [lower, upper] = historyDomain([{ value: -5, best: -5 }, { value: 0.5, best: 0.5 }])
  assert.ok(lower >= -0.6 && lower < -0.5)
  assert.ok(upper > 0.5)
  assert.deepEqual(historyDomain([{ value: null, best: null }]), [0, 1])
  assert.deepEqual(historyDomain(), [0, 1])
})

test('推移グラフの非表示設定を保存し、未保存や読めないときは表示する', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  assert.equal(readHistoryHidden(storage), false)
  writeHistoryHidden(true, storage)
  assert.equal(values.get(HISTORY_HIDDEN_KEY), 'true')
  assert.equal(readHistoryHidden(storage), true)
  writeHistoryHidden(false, storage)
  assert.equal(readHistoryHidden(storage), false)
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(readHistoryHidden(broken), false)
  assert.doesNotThrow(() => writeHistoryHidden(true, broken))
})
