export default function DataPreview({ data }) {
  if (!data) {
    return (
      <div className="card">
        <div className="card-header">
          <h2>データプレビュー</h2>
        </div>
        <div className="card-body" style={{ color: '#94a3b8', fontSize: 13, padding: '32px 24px', textAlign: 'center' }}>
          CSVファイルをアップロードするとここにプレビューが表示されます
        </div>
      </div>
    )
  }

  const { filename, rows, columns, preview } = data

  return (
    <div className="card">
      <div className="card-header">
        <h2>データプレビュー — {filename}</h2>
        <span className="badge">{rows}行 × {columns.length}列</span>
      </div>
      <div className="card-body">
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.name}>
                    {col.name}
                    <br />
                    <span style={{ fontWeight: 400, fontSize: 10, color: '#94a3b8' }}>
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
