import test from 'node:test'
import assert from 'node:assert/strict'
import { interactionView } from './shapInteraction.js'

test('表示する変数の順に相互作用の行列を並べ替え、最大値を求める', () => {
  const shap = { features: ['a', 'b', 'c'], interaction: [[null, 0.1, 0.3], [0.1, null, 0.2], [0.3, 0.2, null]] }
  assert.deepEqual(interactionView(shap, ['c', 'a']), { features: ['c', 'a'], matrix: [[null, 0.3], [0.3, null]], max: 0.3 })
  assert.deepEqual(interactionView(shap, ['b', '不明', 'c']).features, ['b', 'c'])
})

test('相互作用がない古い結果や、変数が2つ未満のときは表示しない', () => {
  assert.equal(interactionView({ features: ['a'], importance: [] }, ['a']), null)
  assert.equal(interactionView(undefined, ['a', 'b']), null)
  assert.equal(interactionView({ features: ['a', 'b'], interaction: [[null, 0], [0, null]] }, ['a']), null)
})
