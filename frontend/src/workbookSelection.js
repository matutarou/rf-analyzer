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

export function previewSourceSheets(data) {
  const sources = data.columns.map(column => column.source_sheet).filter(Boolean)
  return [...new Set(sources.length ? sources : data.selected_sheets || [])]
}

export function featureColumns(columns) {
  const candidates = columns.slice(1)
  return columns.some(column => isFactorSheet(column.source_sheet))
    ? candidates.filter(column => isFactorSheet(column.source_sheet))
    : candidates
}
