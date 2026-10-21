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
  writer.update({ name: '分析', target: 'x' })
  const first = writer.flush()
  writer.update({ name: '分析', target: 'y' })
  assert.equal(writer.flush(), first)
  release()
  await first
  assert.deepEqual(requests, [{ name: '分析', target: 'x', expected_version: 0 }, { name: '分析', target: 'y', expected_version: 1 }])
  assert.equal(writer.dirty, false)
})

test('空の新規分析は変更や切替時のflushでも保存せず、未保存扱いにしない', async () => {
  const requests = []
  const statuses = []
  const writer = new WorkspaceWriter(async payload => {
    requests.push(payload)
    return { version: 1 }
  }, 0, status => statuses.push(status))
  writer.update({ name: '新しい分析', view: { left_pct: 50 } })
  assert.equal(writer.blank, true)
  assert.equal(writer.dirty, false)
  await writer.flush()
  writer.update({ name: '変更した名前' })
  assert.equal(writer.dirty, true)
  writer.update({ name: '新しい分析', params: { n_trials: 50 } })
  await writer.flush()
  assert.deepEqual(requests, [])
  assert.deepEqual(statuses, ['new', 'new'])
  assert.equal(writer.version, 0)
})

test('意味のある入力を保存した後は内容を消しても保存する', async () => {
  const requests = []
  const writer = new WorkspaceWriter(async payload => {
    requests.push(payload)
    return { version: payload.expected_version + 1 }
  })
  writer.update({ chat: { input: '下書き' } })
  await writer.flush()
  writer.update({ chat: { input: '' } })
  assert.equal(writer.blank, false)
  assert.equal(writer.dirty, true)
  await writer.flush()
  assert.equal(requests.length, 2)
  assert.equal(writer.version, 2)
  assert.equal(writer.dirty, false)
})

for (const [label, snapshot] of [
  ['名前付きの新規分析', { name: '人口と公共施設の分析' }],
  ['人口ピラミッドのみの新規分析', { population_pyramid: { cities: [] } }],
]) {
  test(`${label}は保存する`, async () => {
    const requests = []
    const statuses = []
    const writer = new WorkspaceWriter(async payload => {
      requests.push(payload)
      return { version: 1 }
    }, 0, status => statuses.push(status))
    writer.update(snapshot)
    assert.equal(writer.blank, false)
    assert.equal(writer.dirty, true)
    await writer.flush()
    assert.deepEqual(requests, [{ ...snapshot, expected_version: 0 }])
    assert.deepEqual(statuses, ['saving', 'saved'])
    assert.equal(writer.dirty, false)
  })
}

test('保存済みの空分析を開いた場合も通常通り保存する', async () => {
  const requests = []
  const writer = new WorkspaceWriter(async payload => {
    requests.push(payload)
    return { version: payload.expected_version + 1 }
  }, 2)
  writer.update({ name: '新しい分析' })
  assert.equal(writer.blank, false)
  assert.equal(writer.dirty, true)
  await writer.flush()
  assert.deepEqual(requests, [{ name: '新しい分析', expected_version: 2 }])
  assert.equal(writer.version, 3)
})

test('初回保存の通信中に空へ戻しても保存完了後に消去内容を保存する', async () => {
  const requests = []
  let release
  const writer = new WorkspaceWriter(async payload => {
    requests.push(payload)
    if (requests.length === 1) await new Promise(resolve => { release = resolve })
    return { version: payload.expected_version + 1 }
  })
  writer.update({ name: '入力' })
  const saving = writer.flush()
  writer.update({ name: '新しい分析' })
  release()
  await saving
  assert.deepEqual(requests.map(payload => payload.expected_version), [0, 1])
  assert.equal(requests[1].name, '新しい分析')
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
