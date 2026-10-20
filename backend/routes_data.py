"""ヘルスチェック、データのアップロードと行取得。"""

import json
import os
import uuid

import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException

from preprocessing import to_python
from state import UPLOAD_DIR, uploaded_data


router = APIRouter(prefix="/api")


@router.get("/health")
def health_check():
    return {"status": "ok"}



@router.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    """CSVファイルをアップロードし，カラム情報を返す"""
    if not file.filename.endswith((".csv", ".tsv", ".xlsx")):
        raise HTTPException(status_code=400, detail="CSV，TSV，またはXLSXファイルをアップロードしてください")

    file_id = str(uuid.uuid4())

    try:
        contents = await file.read()
        filepath = os.path.join(UPLOAD_DIR, f"{file_id}_{file.filename}")
        with open(filepath, "wb") as f:
            f.write(contents)

        if file.filename.endswith(".xlsx"):
            df = pd.read_excel(filepath)
        elif file.filename.endswith(".tsv"):
            df = pd.read_csv(filepath, sep="\t")
        else:
            # エンコーディングを自動判定
            for enc in ["utf-8", "shift_jis", "cp932", "euc-jp"]:
                try:
                    df = pd.read_csv(filepath, encoding=enc)
                    break
                except (UnicodeDecodeError, pd.errors.ParserError):
                    continue
            else:
                raise HTTPException(status_code=400, detail="ファイルのエンコーディングを判定できませんでした")

        uploaded_data[file_id] = df

        # カラム情報を作成
        columns_info = []
        for col in df.columns:
            col_info = {
                "name": col,
                "dtype": str(df[col].dtype),
                "null_count": int(df[col].isnull().sum()),
                "unique_count": int(df[col].nunique()),
            }
            if pd.api.types.is_numeric_dtype(df[col]):
                col_info["min"] = float(df[col].min()) if not df[col].isnull().all() else None
                col_info["max"] = float(df[col].max()) if not df[col].isnull().all() else None
                col_info["mean"] = float(df[col].mean()) if not df[col].isnull().all() else None
            else:
                col_info["sample_values"] = df[col].dropna().unique()[:5].tolist()

            columns_info.append(col_info)

        return {
            "file_id": file_id,
            "filename": file.filename,
            "rows": len(df),
            "columns": columns_info,
            "preview": json.loads(df.head(5).to_json(orient="records", force_ascii=False)),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ファイル処理中にエラーが発生: {str(e)}")



@router.get("/rows/{file_id}")
async def get_rows(file_id: str):
    """アップロード済みデータの全行を返す（行選択UI用）"""
    if file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="データが見つかりません．再アップロードしてください")

    df = uploaded_data[file_id]
    columns = list(df.columns)
    rows = []
    for i in range(len(df)):
        row = {col: to_python(df.iloc[i][col]) for col in columns}
        row["__index__"] = i
        rows.append(row)

    return {"file_id": file_id, "columns": columns, "rows": rows, "total": len(df)}
