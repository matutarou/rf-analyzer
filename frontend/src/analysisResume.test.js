import test from 'node:test'
import assert from 'node:assert/strict'
import { canResume, clearPendingJob, readPendingJob, savePendingJob } from './analysisResume.js'

const memory = () => {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

test('実行中のジョブを分析ごとに保存・読込・削除する', () => {
  const storage = memory()
  const job = { jobId: 'job-1', target: '人口', features: ['a', 'b'], params: { n_trials: 50 } }
  savePendingJob('p1', job, storage)
  assert.deepEqual(readPendingJob('p1', storage), job)
  assert.equal(readPendingJob('p2', storage), null)
  clearPendingJob('p1', storage)
  assert.equal(readPendingJob('p1', storage), null)
})

test('壊れた記録や保存できない環境では引き継がない', () => {
  const storage = memory()
  storage.setItem('rf_analyzer_pending_job_p1', '{壊れた')
  assert.equal(readPendingJob('p1', storage), null)
  storage.setItem('rf_analyzer_pending_job_p1', JSON.stringify({ target: '人口' }))
  assert.equal(readPendingJob('p1', storage), null)
  const broken = { getItem: () => { throw new Error() }, setItem: () => { throw new Error() }, removeItem: () => { throw new Error() } }
  assert.doesNotThrow(() => savePendingJob('p1', { jobId: 'x' }, broken))
  assert.equal(readPendingJob('p1', broken), null)
  assert.doesNotThrow(() => clearPendingJob('p1', broken))
})

test('目的変数・説明変数が同じときだけ引き継ぐ', () => {
  const job = { jobId: 'j', target: '人口', features: ['a', 'b'] }
  assert.equal(canResume(job, '人口', ['a', 'b']), true)
  assert.equal(canResume(job, '人口', ['b', 'a']), false)
  assert.equal(canResume(job, '人口増減率', ['a', 'b']), false)
  assert.equal(canResume(null, '人口', ['a', 'b']), false)
})
