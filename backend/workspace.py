"""ローカルの分析記録、品質診断、レポートを扱う。"""
import hashlib
import html
import io
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
import model_store
from population import PopulationPyramidData

DB_PATH = Path(__file__).parent / "data" / "workspace.sqlite3"


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, created TEXT, fingerprint TEXT, dataset TEXT, state TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, created TEXT, payload TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS model_artifacts (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, payload BLOB NOT NULL, digest TEXT NOT NULL)")
    columns = {r[1] for r in db.execute("PRAGMA table_info(projects)")}
    if "version" not in columns:
        db.execute("ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    if "updated" not in columns:
        db.execute("ALTER TABLE projects ADD COLUMN updated TEXT")
    if "model_id" not in columns:
        db.execute("ALTER TABLE projects ADD COLUMN model_id TEXT")
    try:
        with db:
            yield db
    finally:
        db.close()


def inspect_data(df, target="", features=None):
    features = features or []
    selected = list(dict.fromkeys(features + ([target] if target else [])))
    if any(c not in df.columns for c in selected):
        raise HTTPException(400, "存在しない変数が選択されています")
    columns = []
    for name in df.columns:
        s = df[name]
        numeric = pd.api.types.is_numeric_dtype(s)
        parsed = pd.to_numeric(s, errors="coerce")
        columns.append({"name": name, "dtype": str(s.dtype), "missing": int(s.isna().sum()),
                        "unique": int(s.nunique()), "constant": bool(s.nunique() <= 1),
                        "numeric_like": bool(not numeric and parsed.notna().any()),
                        "infinite": int(np.isinf(parsed.astype(float)).sum()),
                        "encoding": "数値のまま" if numeric else "ラベルエンコード",
                        "target_copy": bool(target and name != target and s.equals(df[target]))})
    excluded = df[selected].isna().any(axis=1).to_numpy() if selected else np.zeros(len(df), dtype=bool)
    omitted = [{"row": int(i + 1), "columns": [c for c in selected if pd.isna(df.iloc[i][c])]}
               for i in np.flatnonzero(excluded)]
    mapping = {}
    for c in features:
        if not pd.api.types.is_numeric_dtype(df[c]):
            values = sorted(df.loc[~excluded, c].astype(str).unique())
            mapping[c] = {"total": len(values), "values": [{"value": v, "code": i} for i, v in enumerate(values[:100])]}
    errors = []
    if target and target in features:
        errors.append("目的変数が説明変数に含まれています")
    if target and not pd.api.types.is_numeric_dtype(df[target]):
        errors.append("目的変数は数値型を選択してください")
    if selected and any(c["infinite"] for c in columns if c["name"] in selected):
        errors.append("選択した変数に無限値があります")
    if target and len(df) - int(excluded.sum()) < 10:
        errors.append("欠損除外後のデータが10件未満です")
    return {"rows": len(df), "duplicates": int(df.duplicated().sum()), "columns": columns,
            "included": int((~excluded).sum()), "excluded_count": len(omitted),
            "excluded": omitted, "encoding": mapping, "errors": errors}


def columns_info(df):
    columns = []
    for c in df.columns:
        s = df[c]
        info = {"name": c, "dtype": str(s.dtype), "null_count": int(s.isna().sum()), "unique_count": int(s.nunique())}
        source = df.attrs.get('source_sheets', {}).get(c)
        if source:
            info['source_sheet'] = source
        if pd.api.types.is_numeric_dtype(s):
            for key in ("min", "max", "mean"):
                value = getattr(s, key)()
                info[key] = float(value) if pd.notna(value) and np.isfinite(value) else None
        else:
            info["sample_values"] = s.dropna().astype(str).unique()[:5].tolist()
        columns.append(info)
    return columns


class Selection(BaseModel):
    file_id: str
    target: str = ""
    features: list[str] = Field(default_factory=list, max_length=500)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    question: str = ""
    model: str = ""
    sources: list[dict] = Field(default_factory=list)


class ChatState(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    input: str = ""
    screen_context: str = ""


class ViewState(BaseModel):
    assistant_tab: Literal["explain", "chat", "knowledge", "feedback"] = "explain"
    left_pct: float = Field(default=65, ge=30, le=80)
    left_scroll: float = Field(default=0, ge=0)
    right_scroll: float = Field(default=0, ge=0)
    quality_ready: bool = False


class Project(BaseModel):
    file_id: str | None = None
    name: str = Field(min_length=1, max_length=150)
    filename: str = Field(default="data", max_length=300)
    target: str = ""
    features: list[str] = Field(default_factory=list)
    params: dict = Field(default_factory=dict)
    results: dict | None = None
    population_pyramid: PopulationPyramidData | None = None
    ai: dict = Field(default_factory=dict)
    data_mode: Literal["single", "separate"] = "single"
    chat: ChatState = Field(default_factory=ChatState)
    view: ViewState = Field(default_factory=ViewState)
    expected_version: int = Field(default=0, ge=0)


def encode_dataset(df):
    # pandasのJSON出力を通さず、浮動小数点のビット精度と列の型を保持する。
    def encode(value):
        if isinstance(value, (float, np.floating)):
            return {"float": float(value).hex()}
        if value is None or value is pd.NA or value is pd.NaT:
            return None
        if isinstance(value, (pd.Timestamp, datetime)):
            return {"datetime": value.isoformat()}
        if isinstance(value, np.generic):
            return value.item()
        return value
    return json.dumps({"format": "lossless-v1", "columns": [
        {"name": c, "dtype": str(df[c].dtype), "values": [encode(v) for v in df[c]],
         **({"source_sheet": df.attrs['source_sheets'][c]} if c in df.attrs.get('source_sheets', {}) else {})}
        for c in df.columns
    ]}, ensure_ascii=False, allow_nan=False)


def decode_dataset(dataset):
    payload = json.loads(dataset)
    if payload.get("format") != "lossless-v1":
        return pd.read_json(io.StringIO(dataset), orient="table")
    def decode(value):
        if isinstance(value, dict) and "float" in value:
            return float.fromhex(value["float"])
        if isinstance(value, dict) and "datetime" in value:
            return pd.Timestamp(value["datetime"])
        return value
    frame = pd.DataFrame({c["name"]: pd.Series([decode(v) for v in c["values"]], dtype=c["dtype"])
                          for c in payload["columns"]})
    frame.attrs['source_sheets'] = {column['name']: column['source_sheet'] for column in payload['columns'] if column.get('source_sheet')}
    return frame


def dataset_fingerprint(df):
    return hashlib.sha256(encode_dataset(df).encode()).hexdigest()


class Feedback(BaseModel):
    rating: Literal["helpful", "incorrect", "unclear"]
    question: str = Field(default="", max_length=10000)
    answer: str = Field(min_length=1, max_length=30000)
    comment: str = Field(default="", max_length=3000)
    model: str = Field(default="", max_length=100)


def report(record):
    state = json.loads(record["state"])
    result = state.get("results") or {}
    esc = lambda value: html.escape(str(value))
    def table(items):
        return "<table>" + "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in items) + "</table>"
    importance = result.get("feature_importance", [])
    bars = "".join(f'<div>{esc(v["feature"])} <meter min="0" max="1" value="{float(v["importance"])}"></meter> {float(v["importance"]):.4f}</div>' for v in importance)
    ai = state.get("ai", {})
    comments = "".join(f'<h3>{esc(v.get("label", v.get("role", "")))}</h3><p>{esc(v.get("content", ""))}</p>' for v in ai.get("explanations", []))
    return f'''<!doctype html><html lang="ja"><meta charset="utf-8"><title>{esc(record['name'])}</title>
<style>body{{font-family:system-ui;max-width:960px;margin:32px auto;padding:20px;line-height:1.7;color:#222}}h1{{font-size:24px}}h2{{font-size:18px;border-bottom:1px solid #aaa}}td,th{{border:1px solid #ddd;padding:8px;text-align:left;overflow-wrap:anywhere}}table{{border-collapse:collapse;width:100%}}p,pre{{white-space:pre-wrap;overflow-wrap:anywhere}}meter{{width:45%}}@media print{{body{{margin:0}}}}</style>
<h1>{esc(record['name'])}</h1><p>{esc(record['created'])}</p>
<h2>分析条件</h2>{table([('ファイル', state['filename']), ('目的変数', state['target']), ('説明変数', ', '.join(state['features'])), ('データ識別', record['fingerprint'])])}
<pre>{esc(json.dumps(state['params'], ensure_ascii=False, indent=2))}</pre>
<h3>最適化後の設定</h3><pre>{esc(json.dumps(result.get('best_params'), ensure_ascii=False, indent=2))}</pre>
<h2>評価値</h2>{table(result.get('metrics', {}).get('cv', {}).items())}
<h2>特徴量重要度</h2>{bars}<h2>SHAP重要度</h2>{table([(v['feature'], v['mean_abs_shap']) for v in result.get('shap', {}).get('importance', [])])}
<h2>前処理</h2>{table([(k, v) for k, v in (state.get('quality') or {}).items() if k in ('rows', 'included', 'excluded_count', 'duplicates')])}
<h2>3視点解説</h2>{comments}<h2>共通点・相違点</h2><p>{esc(ai.get('summary', '未生成'))}</p>
<h2>残差統計</h2>{table(result.get('residual_stats', {}).items())}
<h2>注意事項</h2><p>重要度は因果効果を示しません。自動調整時の評価値は設定選択にも使われています。AI解説は原データと照合してください。</p></html>'''


def create_router(uploaded, trained_models, artifacts):
    router = APIRouter(prefix="/api")

    def data(file_id):
        if file_id not in uploaded:
            raise HTTPException(404, "データがありません。保存記録を再開するか再アップロードしてください")
        return uploaded[file_id]

    def find(project_id):
        with connect() as db:
            row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "記録が見つかりません")
        return dict(row)

    @router.post("/quality")
    def quality(req: Selection):
        return inspect_data(data(req.file_id), req.target, req.features)

    @router.post("/relationships")
    def relationships(req: Selection):
        df = data(req.file_id)
        available = df.select_dtypes(include="number").columns.tolist()
        names = list(dict.fromkeys(req.features + ([req.target] if req.target else [])))
        truncated = not names and len(available) > 40
        if not names:
            names = available[:40]
        if len(names) > 40:
            raise HTTPException(400, "相関表示は40変数以内で選択してください")
        if any(c not in df.columns for c in names):
            raise HTTPException(400, "存在しない変数です")
        numeric = df[names].select_dtypes(include="number").replace([np.inf, -np.inf], np.nan)
        corr = numeric.corr(min_periods=3)
        counts = numeric.notna().astype(int).T @ numeric.notna().astype(int)
        pairs = [{"x": a, "y": b, "r": None if pd.isna(corr.loc[a, b]) else float(corr.loc[a, b]), "n": int(counts.loc[a, b])}
                 for i, a in enumerate(numeric.columns) for b in numeric.columns[i + 1:]]
        matrix = [[None if pd.isna(value) else float(value) for value in row] for row in corr.to_numpy()]
        return {"pairs": sorted(pairs, key=lambda p: abs(p['r'] or 0), reverse=True),
                "excluded": [n for n in names if n not in numeric.columns],
                "variables": list(numeric.columns), "matrix": matrix, "counts": counts.to_numpy().tolist(),
                "available": available, "truncated": truncated}

    def persist(req, project_id, create_only=False):
        df = data(req.file_id) if req.file_id else None
        quality = inspect_data(df, req.target, req.features) if df is not None else {}
        dataset = encode_dataset(df) if df is not None else ""
        fingerprint = hashlib.sha256(dataset.encode()).hexdigest()
        artifact = artifacts.get(req.file_id)
        if artifact and not artifact.matches(fingerprint, req.target, req.features, req.params, req.results):
            artifact = None
        state = req.model_dump(exclude={"file_id", "expected_version"})
        # パラメータは既知項目だけ保存し、認証情報を含めない
        allowed = {"optimize", "optimize_metric", "n_trials", "n_estimators", "max_depth", "min_samples_split", "min_samples_leaf", "random_state", "shap_top_n", "importance_top_n"}
        state["params"] = {k: v for k, v in req.params.items() if k in allowed}
        state["ai"] = {"explanations": req.ai.get("explanations", []), "summary": req.ai.get("summary", ""), "model": req.ai.get("model", "")}
        state["quality"] = quality
        state["trained_params"] = artifact.metadata["trained_params"] if artifact else None
        updated = datetime.now(timezone.utc).isoformat()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT version FROM projects WHERE id=?", (project_id,)).fetchone()
            version = previous["version"] if previous else 0
            if (create_only and previous) or version != req.expected_version:
                raise HTTPException(409, "別の画面で履歴が更新されています。変更を残すには別名保存してください")
            version += 1
            model_id = artifact.metadata["id"] if artifact else None
            if artifact:
                db.execute("INSERT OR IGNORE INTO model_artifacts VALUES (?,?,?,?)",
                           (model_id, json.dumps(artifact.metadata, ensure_ascii=False), artifact.payload, artifact.digest))
            values = (req.name, updated, fingerprint, dataset,
                      json.dumps(state, ensure_ascii=False, allow_nan=False), version)
            if previous:
                db.execute("UPDATE projects SET name=?,updated=?,fingerprint=?,dataset=?,state=?,version=?,model_id=? WHERE id=?", (*values, model_id, project_id))
            else:
                db.execute("INSERT INTO projects (name,updated,fingerprint,dataset,state,version,model_id,id,created) VALUES (?,?,?,?,?,?,?,?,?)", (*values, model_id, project_id, updated))
            db.execute("DELETE FROM model_artifacts WHERE id NOT IN (SELECT model_id FROM projects WHERE model_id IS NOT NULL)")
        return {"id": project_id, "version": version, "updated": updated}

    @router.post("/projects", status_code=201)
    def save(req: Project):
        return persist(req, str(uuid.uuid4()), create_only=True)

    @router.put("/projects/{project_id}")
    def update(project_id: uuid.UUID, req: Project):
        return persist(req, str(project_id))

    @router.get("/projects")
    def listing(compact: bool = False):
        with connect() as db:
            rows = db.execute("SELECT id,name,created,updated,version,fingerprint,state FROM projects ORDER BY COALESCE(updated,created) DESC").fetchall()
        records = []
        for r in rows:
            state = json.loads(r["state"])
            records.append({"id": r["id"], "name": r["name"], "created": r["created"], "updated": r["updated"] or r["created"], "version": r["version"], "fingerprint": r["fingerprint"],
                            "cohort": [e["row"] for e in state.get("quality", {}).get("excluded", [])],
                            **{k: v for k, v in state.items() if k in ("target", "features", "params", "results")}})
        if compact:
            return [{k: r[k] for k in ("id", "name", "created", "updated", "version", "target")} for r in records]
        return records

    @router.post("/projects/{project_id}/restore")
    def restore(project_id: str):
        row = find(project_id)
        state = json.loads(row["state"])
        if not row["dataset"]:
            return {"id": project_id, "version": row["version"], "state": state, "file_info": None}
        df = decode_dataset(row["dataset"])
        file_id = str(uuid.uuid4())
        uploaded[file_id] = df
        status = {"available": False, "reason": "この履歴には学習済みモデルがありません。シミュレーションには一度再分析が必要です。" if state.get("results") else ""}
        state["trained_params"] = None
        if row["model_id"]:
            with connect() as db:
                saved_model = db.execute("SELECT * FROM model_artifacts WHERE id=?", (row["model_id"],)).fetchone()
            if saved_model:
                try:
                    artifact = model_store.ModelArtifact(json.loads(saved_model["metadata"]), saved_model["payload"], saved_model["digest"])
                    if not artifact.matches(dataset_fingerprint(df), state["target"], state["features"], state["params"], state.get("results")):
                        raise model_store.ModelUnavailable("データ・分析条件と保存モデルが一致しません。モデルは再分析が必要です。")
                    # 環境不一致でも成果物を保持し、自動保存による消失を防ぐ。
                    artifacts[file_id] = artifact
                    trained_models[file_id] = model_store.unpack_model(artifact)
                    state["trained_params"] = artifact.metadata["trained_params"]
                    status = {"available": True, "reason": ""}
                except (ValueError, KeyError, TypeError) as error:
                    status = {"available": False, "reason": str(error) if isinstance(error, model_store.ModelUnavailable) else "保存モデルの情報が破損しています。モデルは再分析が必要です。"}
            else:
                status["reason"] = "保存モデルが見つかりません。モデルは再分析が必要です。"
        return {"id": project_id, "version": row["version"], "state": state, "model_status": status, "file_info": {"file_id": file_id, "filename": state["filename"], "rows": len(df), "columns": columns_info(df), "preview": json.loads(df.head(5).to_json(orient="records"))}}

    @router.delete("/projects/{project_id}")
    def delete(project_id: str):
        find(project_id)
        with connect() as db:
            db.execute("DELETE FROM projects WHERE id=?", (project_id,))
            db.execute("DELETE FROM model_artifacts WHERE id NOT IN (SELECT model_id FROM projects WHERE model_id IS NOT NULL)")
        return {"deleted": project_id}

    @router.get("/projects/{project_id}/report", response_class=HTMLResponse)
    def export_report(project_id: str):
        return HTMLResponse(report(find(project_id)), headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})

    @router.post("/feedback", status_code=201)
    def feedback(req: Feedback):
        feedback_id = str(uuid.uuid4())
        with connect() as db:
            db.execute("INSERT INTO feedback VALUES (?,?,?)", (feedback_id, datetime.now(timezone.utc).isoformat(), req.model_dump_json()))
        return {"id": feedback_id}

    @router.get("/feedback")
    def feedback_list():
        with connect() as db:
            rows = db.execute("SELECT * FROM feedback ORDER BY created DESC LIMIT 200").fetchall()
        return [{"id": r["id"], "created": r["created"], **json.loads(r["payload"])} for r in rows]

    return router
