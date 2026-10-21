import { previewSourceSheets } from '../workbookSelection'

export default function DataPreview({ data }) {
  if (!data) {
    return (
      <div className="card">
        <div className="card-header">
          <h2>データプレビュー</h2>
        </div>
        <div className="card-body" style={{ color: '#94a3b8', fontSize: 13, padding: '32px 24px', textAlign: 'center' }}>
          CSV・TSV・Excelファイルをアップロードするとここにプレビューが表示されます
        </div>
      </div>
    )
  }

  const { filename, rows, columns, preview } = data
  const sourceSheets = previewSourceSheets(data)

  return (
    <div className="card">
      <div className="card-header">
        <h2>データプレビュー — {filename}</h2>
        <span className="badge">{rows}行 × {columns.length}列</span>
      </div>
      <div className="card-body">
        {sourceSheets.length > 0 && <p>{sourceSheets.length > 1 ? '結合プレビュー' : '表示シート'}: {sourceSheets.join(' ＋ ')}（先頭{preview.length}行）</p>}
        {sourceSheets.length > 1 && <p>共通キーで対応付けたデータを表示しています。基準シートの行を維持し、対応するデータがない追加列は「—」で表示します。</p>}
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.name}>
                    {col.name}
                    <br />
                    <span style={{ fontWeight: 400, fontSize: 10, color: '#94a3b8' }}>
                      {col.source_sheet && <>{col.source_sheet}<br /></>}
                      {col.dtype} | 欠損: {col.null_count}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.name}>
                      {row[col.name] != null ? String(row[col.name]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
