import test from 'node:test'
import assert from 'node:assert/strict'
import { isBlankWorkspace } from './isBlankWorkspace.js'

const blank = { name: '新しい分析', file_id: null, results: null,
  ai: { explanations: [], summary: '' }, chat: { messages: [], input: '', screen_context: '' }, population_pyramid: null }

for (const [label, snapshot, version, expected] of [
  ['空の初期状態', blank, 0, true],
  ['省略された初期状態', {}, 0, true],
  ['既定名の前後空白', { ...blank, name: ' 新しい分析　' }, 0, true],
  ['空白のみの名前と下書き', { ...blank, name: '　 ', chat: { input: ' \n ' } }, 0, true],
  ['名前変更', { ...blank, name: ' 分析A ' }, 0, false],
  ['ファイルあり', { ...blank, file_id: 'file-1' }, 0, false],
  ['チャット下書き', { ...blank, chat: { input: '質問' } }, 0, false],
  ['チャット履歴', { ...blank, chat: { messages: [{ role: 'user', content: '質問' }] } }, 0, false],
  ['分析結果', { ...blank, results: { r2: 0.9 } }, 0, false],
  ['AI解説', { ...blank, ai: { explanations: [{ text: '解説' }], summary: '' } }, 0, false],
  ['AI要約', { ...blank, ai: { explanations: [], summary: '要約' } }, 0, false],
  ['空白のみのAI要約', { ...blank, ai: { explanations: [], summary: ' \n　' } }, 0, true],
  ['人口ピラミッドのみ', { ...blank, population_pyramid: { cities: [] } }, 0, false],
  ['view変更のみ', { ...blank, view: { left_pct: 40, left_scroll: 100, assistant_tab: 'chat' } }, 0, true],
  ['パラメータのみ', { ...blank, params: { optimize: true, n_trials: 50 } }, 0, true],
  ['画面コンテキストとモデルのみ', { ...blank, chat: { screen_context: '画面情報' }, ai: { model: 'model' } }, 0, true],
  ['保存済みの空レコード', blank, 1, false],
]) {
  test(label, () => assert.equal(isBlankWorkspace(snapshot, version), expected))
}
