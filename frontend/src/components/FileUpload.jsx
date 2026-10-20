import { useState, useRef } from 'react'

export default function FileUpload({ onUpload, fileInfo }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onUpload(file)
  }

  const handleChange = (e) => {
    const file = e.target.files[0]
    if (file) onUpload(file)
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <h2>学習データ</h2>
        {fileInfo && (
          <span className="badge">{fileInfo.rows.toLocaleString()} 行 × {fileInfo.columns.length} 列</span>
        )}
      </div>
      <div className="card-body" style={{ padding: '16px 24px' }}>
        {fileInfo ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{fileInfo.filename}</div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => inputRef.current?.click()}
            >
              ファイルを変更
            </button>
          </div>
        ) : (
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            style={{ padding: '40px 24px', margin: 0 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <h3>学習データをアップロード</h3>
            <p>ファイルをドラッグ＆ドロップ，またはクリックして選択</p>
            <p className="formats">対応形式: CSV (.csv) / TSV (.tsv) / Excel (.xlsx)</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.xlsx"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
