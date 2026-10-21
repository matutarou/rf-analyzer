import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSISTANT_HIDDEN_KEY, parseAssistantHidden, readAssistantHidden, writeAssistantHidden } from './assistantVisibility.js'

test('保存値が true のときだけ非表示にする', () => {
  assert.equal(parseAssistantHidden('true'), true)
  for (const value of [null, undefined, '', 'false', '1', 'invalid']) {
    assert.equal(parseAssistantHidden(value), false)
  }
})

test('画面設定を専用キーで保存し、次の読込でも維持する', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  assert.equal(readAssistantHidden(storage), false)
  assert.equal(writeAssistantHidden(true, storage), true)
  assert.equal(values.get(ASSISTANT_HIDDEN_KEY), 'true')
  assert.equal(readAssistantHidden(storage), true)
  assert.equal(writeAssistantHidden(false, storage), true)
  assert.equal(values.get(ASSISTANT_HIDDEN_KEY), 'false')
  assert.equal(readAssistantHidden(storage), false)
})

test('ストレージの読み書きが拒否されても例外を出さない', () => {
  const storage = {
    getItem: () => { throw new Error('読込不可') },
    setItem: () => { throw new Error('書込不可') },
  }
  assert.equal(readAssistantHidden(storage), false)
  assert.equal(writeAssistantHidden(true, storage), false)
})

test('localStorage 自体へのアクセスが拒否されても例外を出さない', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new Error('アクセス不可') },
  })
  try {
    assert.equal(readAssistantHidden(), false)
    assert.equal(writeAssistantHidden(true), false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})
