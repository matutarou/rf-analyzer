import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultWorkbookSelection, featureColumns, previewSourceSheets } from './workbookSelection.js'

const sheet = (name, columns = ['市町村', '率']) => ({ name, rows: 2, columns })

test('Excel内の順序によらず人口関係データを基準に想定される要因を結合する', () => {
  for (const sheets of [
    [sheet('想定される要因'), sheet('人口関係データ')],
    [sheet('人口関係データ'), sheet('想定される要因')],
    [sheet('別シート'), sheet('想定される要因'), sheet('人口ピラミッド', ['市町村', '性別', '年齢', '人口']), sheet('人口関係データ')],
  ]) {
    assert.deepEqual(defaultWorkbookSelection(sheets).sheetNames, ['人口関係データ', '想定される要因'])
  }
})

test('専用シートが片方だけの場合や空の場合は有効なシートだけを選ぶ', () => {
  assert.deepEqual(defaultWorkbookSelection([sheet('人口関係データ')]).sheetNames, ['人口関係データ'])
  assert.deepEqual(defaultWorkbookSelection([sheet('想定される要因')]).sheetNames, ['想定される要因'])
  assert.deepEqual(defaultWorkbookSelection([sheet('人口関係データ'), { ...sheet('想定される要因'), rows: 0 }]).sheetNames, ['人口関係データ'])
})

test('結合プレビューの出典は保存・復元した列情報から重複なく取得する', () => {
  const columns = [
    { source_sheet: '人口関係データ' }, { source_sheet: '人口関係データ' }, { source_sheet: '想定される要因' },
  ]
  assert.deepEqual(previewSourceSheets({ columns }), ['人口関係データ', '想定される要因'])
  assert.deepEqual(previewSourceSheets({ columns: [{}], selected_sheets: ['分析'] }), ['分析'])
  assert.deepEqual(previewSourceSheets({ columns: [{}] }), [])
})

test('想定される要因を学習用、人口ピラミッドを可視化用に初期選択する', () => {
  const selection = defaultWorkbookSelection([
    sheet('目的変数'), sheet('人口ピラミッド・旧版', ['自治体', '性別', '年齢', '人口']),
    sheet('人口ピラミッド', ['市町村', '性別', '年齢', '人口']), sheet('想定される要因'),
  ])
  assert.deepEqual(selection.sheetNames, ['想定される要因'])
  assert.deepEqual(selection.pyramidConfig, {
    sheet_name: '人口ピラミッド', municipality_column: '市町村', sex_column: '性別', age_column: '年齢', population_column: '人口',
  })
})

test('専用シートがなければ従来通り先頭の有効なシートを選ぶ', () => {
  const selection = defaultWorkbookSelection([{ ...sheet('想定される要因'), rows: 0 }, sheet('分析')])
  assert.deepEqual(selection, { sheetNames: ['分析'], pyramidConfig: null })
  assert.deepEqual(defaultWorkbookSelection([]), { sheetNames: [], pyramidConfig: null })
})

test('人口ピラミッドだけのExcelは分析シートとして選択しない', () => {
  const selection = defaultWorkbookSelection([sheet('人口ピラミッド', ['市町村', '性別', '年齢', '人口'])])
  assert.deepEqual(selection.sheetNames, [])
  assert.equal(selection.pyramidConfig.sheet_name, '人口ピラミッド')
})

test('結合後も想定される要因由来の列だけを説明変数候補にする', () => {
  const columns = [
    { name: '市町村', source_sheet: '目的変数' }, { name: '率', source_sheet: '目的変数' },
    { name: '想定される要因 / 施設数', source_sheet: '想定される要因' },
    { name: '別シート / 所得', source_sheet: '別シート' },
  ]
  assert.deepEqual(featureColumns(columns), [columns[2]])
})

test('想定される要因が基準の場合は自治体列を除き、CSVや旧履歴の候補は維持する', () => {
  const columns = [{ name: '市町村', source_sheet: '想定される要因' }, { name: '施設数', source_sheet: '想定される要因' }]
  assert.deepEqual(featureColumns(columns), [columns[1]])
  const legacy = [{ name: '市町村' }, { name: '施設数' }, { name: '所得' }]
  assert.deepEqual(featureColumns(legacy), legacy.slice(1))
  assert.deepEqual(featureColumns([]), [])
})
