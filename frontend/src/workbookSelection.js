import { guessPyramidConfig } from './populationPyramid.js'

export function defaultWorkbookSelection(sheets) {
  const available = sheets.filter(sheet => sheet.rows > 0 && sheet.columns.length > 0)
  const pyramid = available.find(sheet => sheet.name === '人口ピラミッド')
    || available.find(sheet => sheet.name.includes('人口ピラミッド') && sheet.columns.length >= 4)
  const analysis = available.filter(sheet => sheet.name !== pyramid?.name)
  const population = analysis.find(sheet => sheet.name === '人口関係データ')
  const factors = analysis.find(sheet => sheet.name === '想定される要因')
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
  return columns.some(column => column.source_sheet === '想定される要因')
    ? candidates.filter(column => column.source_sheet === '想定される要因')
    : candidates
}
