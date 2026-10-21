"""ヘルスチェック、データのアップロードと行取得。"""

import io
import json
import os
import uuid
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import ValidationError

from preprocessing import to_python
from state import UPLOAD_DIR, uploaded_data
from workspace import columns_info
from population import PyramidConfig, population_pyramid


router = APIRouter(prefix="/api")


@router.get("/health")
def health_check():
    return {"status": "ok"}



def read_sheet(book, name):
    frame = pd.read_excel(book, sheet_name=name)
    frame.columns = frame.columns.map(str)
    if not frame.columns.is_unique:
        raise HTTPException(400, f"「{name}」の列名が重複しています")
    return frame


def read_pyramid(book, config_json):
    try:
        config = PyramidConfig.model_validate_json(config_json)
    except ValidationError:
        raise HTTPException(400, "人口ピラミッド用シートと4つの列を指定してください")
    if config.sheet_name not in book.sheet_names:
        raise HTTPException(400, "人口ピラミッド用シートが存在しません")
    return population_pyramid(read_sheet(book, config.sheet_name), config)


@router.post('/population-pyramid')
async def upload_population_pyramid(pyramid_config: Annotated[str, Form()], file: UploadFile = File(...)):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(400, "人口ピラミッド用のXLSXファイルを選択してください")
    try:
        with pd.ExcelFile(io.BytesIO(await file.read())) as book:
            return read_pyramid(book, pyramid_config)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"人口ピラミッドを読み込めません: {exc}")


@router.post("/upload/sheets")
async def inspect_sheets(file: UploadFile = File(...)):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(400, "XLSXファイルを選択してください")
    try:
        with pd.ExcelFile(io.BytesIO(await file.read())) as book:
            sheets = []
            for name in book.sheet_names:
                frame = read_sheet(book, name)
                sheets.append({"name": name, "rows": len(frame), "columns": list(frame.columns)})
        return {"sheets": sheets}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Excelファイルを読み込めません: {exc}")


def combine_sheets(book, selected, join_keys):
    if not isinstance(selected, list) or not selected or any(not isinstance(name, str) for name in selected):
        raise HTTPException(400, "読み込むシートを1つ以上選択してください")
    if len(set(selected)) != len(selected) or any(name not in book.sheet_names for name in selected):
        raise HTTPException(400, "シートの指定が重複しているか、存在しません")
    if not isinstance(join_keys, dict):
        raise HTTPException(400, "シートごとの結合キーを指定してください")
    frames = {name: read_sheet(book, name) for name in selected}
    if any(frame.empty for frame in frames.values()):
        raise HTTPException(400, "選択したシートにデータがありません")
    if len(selected) == 1:
        frame = frames[selected[0]]
        frame.attrs['source_sheets'] = {column: selected[0] for column in frame.columns}
        return frame, []
    for name, frame in frames.items():
        key = join_keys.get(name)
        if not isinstance(key, str) or key not in frame.columns:
            raise HTTPException(400, f"「{name}」の結合キーを選択してください")
        values = frame[key].astype('string').str.strip()
        if values.isna().any() or values.eq('').any():
            raise HTTPException(400, f"「{name}」の結合キーに空欄があります")
        if values.duplicated().any():
            raise HTTPException(400, f"「{name}」の結合キー「{key}」が重複しています。市町村などが1行ずつになるよう集計してから結合してください")
        frame.index = values
    result = frames[selected[0]]
    sources = {column: selected[0] for column in result.columns}
    warnings = []
    for name in selected[1:]:
        frame = frames[name]
        missing = int((~result.index.isin(frame.index)).sum())
        extra = int((~frame.index.isin(result.index)).sum())
        if missing:
            warnings.append(f"「{name}」と一致しない基準シートの行が{missing}件あります。追加列は欠損値になります。")
        if extra:
            warnings.append(f"「{name}」の基準シートにない{extra}行は取り込みません。")
        additional = frame.drop(columns=join_keys[name]).add_prefix(f"{name} / ")
        if any(column in result.columns for column in additional.columns):
            raise HTTPException(400, "結合後の列名が重複します。元のシート名または列名を変更してください")
        result = result.join(additional, how='left', validate='one_to_one')
        sources.update({column: name for column in additional.columns})
    result.attrs['source_sheets'] = sources
    return result.reset_index(drop=True), warnings


@router.post("/upload")
async def upload_csv(file: UploadFile = File(...), sheet_names: Annotated[str | None, Form()] = None,
                     join_keys: Annotated[str | None, Form()] = None,
                     pyramid_config: Annotated[str | None, Form()] = None):
    """表データをアップロードし、選択したExcelシートを必要に応じて横結合する。"""
    filename = os.path.basename(file.filename or '')
    extension = os.path.splitext(filename)[1].lower()
    if extension not in (".csv", ".tsv", ".xlsx"):
        raise HTTPException(status_code=400, detail="CSV，TSV，またはXLSXファイルをアップロードしてください")

    file_id = str(uuid.uuid4())

    try:
        contents = await file.read()
        filepath = os.path.join(UPLOAD_DIR, f"{file_id}_{filename}")
        with open(filepath, "wb") as f:
            f.write(contents)

        selected = []
        warnings = []
        pyramid = None
        if extension == ".xlsx":
            try:
                selected = json.loads(sheet_names) if sheet_names is not None else None
                keys = json.loads(join_keys) if join_keys is not None else {}
            except (ValueError, TypeError):
                raise HTTPException(400, "シートと結合キーの指定を確認してください")
            with pd.ExcelFile(filepath) as book:
                if sheet_names is None:
                    selected = book.sheet_names[:1]
                df, warnings = combine_sheets(book, selected, keys)
                if pyramid_config is not None:
                    pyramid = read_pyramid(book, pyramid_config)
                    if pyramid['sheet_name'] in selected:
                        raise HTTPException(400, "人口ピラミッド用シートは分析用のシートから外してください")
        elif sheet_names is not None or join_keys is not None or pyramid_config is not None:
            raise HTTPException(400, "シート指定はXLSXファイルのみ使用できます")
        elif extension == ".tsv":
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

        return {
            "file_id": file_id,
            "filename": filename,
            "rows": len(df),
            "columns": columns_info(df),
            "selected_sheets": selected,
            "warnings": warnings,
            "population_pyramid": pyramid,
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
