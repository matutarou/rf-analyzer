import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceWriter } from './workspaceWriter.js'

test('保存中の変更を直列に保存し、同じ履歴のバージョンを進める', async () => {
  const requests = []
  let release
  const writer = new WorkspaceWriter(async payload => {
    requests.push(payload)
    if (requests.length === 1) await new Promise(resolve => { release = resolve })
    return { version: payload.expected_version + 1 }
  })
  writer.update({ target: 'x' })
  const first = writer.flush()
  writer.update({ target: 'y' })
  assert.equal(writer.flush(), first)
  release()
  await first
  assert.deepEqual(requests, [{ target: 'x', expected_version: 0 }, { target: 'y', expected_version: 1 }])
  assert.equal(writer.dirty, false)
})

test('保存失敗時は未保存状態を維持し、同じバージョンで再試行する', async () => {
  let fail = true
  const writer = new WorkspaceWriter(async payload => {
    if (fail) throw new Error('offline')
    return { version: payload.expected_version + 1 }
  }, 3)
  writer.update({ chat: { input: '下書き' } })
  await assert.rejects(writer.flush(), /offline/)
  assert.equal(writer.dirty, true)
  assert.equal(writer.version, 3)
  fail = false
  await writer.flush()
  assert.equal(writer.version, 4)
  assert.equal(writer.dirty, false)
})
