import { guessPyramidConfig } from './populationPyramid.js'

// 説明変数の候補にするシート名（Excelによって「要因」「原因」の表記がある）
export const FACTOR_SHEET_NAMES = ['想定される要因', '想定される原因']
export const isFactorSheet = name => FACTOR_SHEET_NAMES.includes(name)

export function defaultWorkbookSelection(sheets) {
  const available = sheets.filter(sheet => sheet.rows > 0 && sheet.columns.length > 0)
  const pyramid = available.find(sheet => sheet.name === '人口ピラミッド')
    || available.find(sheet => sheet.name.includes('人口ピラミッド') && sheet.columns.length >= 4)
  const analysis = available.filter(sheet => sheet.name !== pyramid?.name)
  const population = analysis.find(sheet => sheet.name === '人口関係データ')
  const factors = analysis.find(sheet => isFactorSheet(sheet.name))
  const first = population || factors || analysis[0]
  const selected = first ? [first.name] : []
  if (population && factors) selected.push(factors.name)
  return { sheetNames: selected, pyramidConfig: guessPyramidConfig(pyramid) }
}

// 人口関係データと想定される要因（原因）がそろっていれば、シート選択を省いて自動で読み込む
export function shouldAutoImport(selection) {
  const [base, factor] = selection.sheetNames
  return selection.sheetNames.length === 2 && base === '人口関係データ' && isFactorSheet(factor)
}

export function featureColumns(columns) {
  const candidates = columns.slice(1)
  return columns.some(column => isFactorSheet(column.source_sheet))
    ? candidates.filter(column => isFactorSheet(column.source_sheet))
    : candidates
}

// 目的変数の候補（数値列）。人口関係データ由来の列があればその列だけに絞り、CSVや旧履歴では全数値列を候補にする
export function targetColumns(columns) {
  const numeric = columns.slice(1).filter(column => column.dtype.includes('int') || column.dtype.includes('float'))
  return columns.some(column => column.source_sheet === '人口関係データ')
    ? numeric.filter(column => column.source_sheet === '人口関係データ')
    : numeric
}
