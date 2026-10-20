"""
自治体データ ランダムフォレスト回帰分析 API
FastAPI backend
"""

import uuid
import os
import json
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from openai import AsyncOpenAI

import numpy as np
import optuna
import pandas as pd
import shap
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import assistant
import rag
import workspace
import model_store
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import cross_val_score, cross_val_predict, LeaveOneOut
from sklearn.metrics import (
    r2_score,
    mean_squared_error,
    mean_absolute_error,
    mean_absolute_percentage_error,
)
from sklearn.preprocessing import LabelEncoder

optuna.logging.set_verbosity(optuna.logging.WARNING)


def resolve_port(env_name: str, default: int) -> int:
    value = os.environ.get(env_name)
    if value is None:
        return default
    message = f"{env_name} は1〜65535の整数で指定してください: {value!r}"
    try:
        port = int(value)
    except ValueError as exc:
        raise ValueError(message) from exc
    if not 1 <= port <= 65535:
        raise ValueError(message)
    return port


BACKEND_PORT = resolve_port("RF_BACKEND_PORT", 8765)
FRONTEND_PORT = resolve_port("RF_FRONTEND_PORT", 5273)

app = FastAPI(title="自治体データ RF回帰分析 API", version="1.0.0")

# CORS設定（フロントエンドからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# アップロードされたデータを一時保存（本番ではDB/キャッシュを使用）
uploaded_data: dict[str, pd.DataFrame] = {}
trained_models: dict[str, tuple] = {}  # file_id -> (model, label_encoders, feature_columns)
model_artifacts: dict[str, model_store.ModelArtifact] = {}
app.include_router(workspace.create_router(uploaded_data, trained_models, model_artifacts))

UPLOAD_DIR = tempfile.mkdtemp()
analysis_jobs = {}
analysis_lock = threading.Lock()
analysis_pool = ThreadPoolExecutor(max_workers=1)


# ========================
# リクエスト/レスポンスモデル
# ========================
class AnalyzeRequest(BaseModel):
    file_id: str
    target_column: str
    feature_columns: list[str]
    n_estimators: int = Field(default=100, ge=1, le=500)
    max_depth: Optional[int] = None
    min_samples_split: int = 2
    min_samples_leaf: int = 1
    random_state: int = 77
    optimize: bool = False
    n_trials: int = Field(default=50, ge=1, le=100)
    optimize_metric: str = "r2"  # "r2" | "rmse" | "mae"
    shap_top_n: int = 5
    cv_folds: int = 5


class PredictMarginalRequest(BaseModel):
    file_id: str
    target_column: str
    feature_columns: list[str]
    baseline_input: dict[str, float]
    sim_input: dict[str, float]
    changed_features: list[str]
    n_estimators: int = 100
    max_depth: Optional[int] = None
    min_samples_split: int = 2
    min_samples_leaf: int = 1
    max_features: str | float | int | None = None
    random_state: int = 77
    model_id: Optional[str] = None


class PredictTestRequest(BaseModel):
    train_file_id: str
    test_file_id: str
    target_column: str
    feature_columns: list[str]
    n_estimators: int = 100
    max_depth: Optional[int] = None
    min_samples_split: int = 2
    min_samples_leaf: int = 1
    max_features: str | float | int | None = None
    random_state: int = 77


class PredictSplitRequest(BaseModel):
    """単一ファイルを行指定で学習/テストに分割して予測するリクエスト"""
    file_id: str
    target_column: str
    feature_columns: list[str]
    test_indices: list[int]  # テストデータにする行の位置インデックス（0始まり）
    n_estimators: int = 100
    max_depth: Optional[int] = None
    min_samples_split: int = 2
    min_samples_leaf: int = 1
    max_features: str | float | int | None = None
    random_state: int = 77


# ========================
# ユーティリティ関数
# ========================
def preprocess_dataframe(df: pd.DataFrame, feature_columns: list[str], target_column: str):
    """
    特徴量とターゲットを前処理する．
    カテゴリ変数はラベルエンコーディングで数値化する．
    """
    df_work = df[feature_columns + [target_column]].dropna()

    label_encoders = {}
    for col in feature_columns:
        if not pd.api.types.is_numeric_dtype(df_work[col]):
            le = LabelEncoder()
            df_work[col] = le.fit_transform(df_work[col].astype(str))
            label_encoders[col] = le

    X = df_work[feature_columns].values
    y = df_work[target_column].values.astype(float)
    return X, y, label_encoders, df_work


METRIC_CONFIG = {
    "r2":   {"direction": "maximize"},
    "rmse": {"direction": "minimize"},
    "mae":  {"direction": "minimize"},
}


def _score_by_metric(y_true, y_pred, metric: str) -> float:
    """指定指標でスコアを計算する（LOOCVのOOF予測用）"""
    if metric == "rmse":
        return float(np.sqrt(mean_squared_error(y_true, y_pred)))
    if metric == "mae":
        return float(mean_absolute_error(y_true, y_pred))
    return float(r2_score(y_true, y_pred))


def optimize_hyperparams(X, y, random_state: int, n_trials: int, metric: str, checkpoint=lambda message: None) -> dict:
    """Optunaで指定指標を最適化するハイパーパラメータを探索する（LOOCVで評価）"""
    cfg = METRIC_CONFIG.get(metric, METRIC_CONFIG["r2"])
    direction = cfg["direction"]
    cv = LeaveOneOut()

    def objective(trial: optuna.Trial) -> float:
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 2, 30),
            "min_samples_split": trial.suggest_int("min_samples_split", 2, 20),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 10),
            "max_features": trial.suggest_categorical("max_features", ["sqrt", "log2", None]),
        }
        model = RandomForestRegressor(**params, random_state=random_state, n_jobs=-1)
        # LOOCVのout-of-fold予測を全件集めて全体スコアを計算する
        y_oof = _loo_predictions(model, X, y, checkpoint, f"最適化 {trial.number + 1}/{n_trials}")
        return _score_by_metric(y, y_oof, metric)

    study = optuna.create_study(direction=direction)
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best = study.best_params
    return {
        "n_estimators": best["n_estimators"],
        "max_depth": best["max_depth"],
        "min_samples_split": best["min_samples_split"],
        "min_samples_leaf": best["min_samples_leaf"],
        "max_features": best["max_features"],
        "metric": metric,
        "best_cv_score": study.best_value,
    }


# ========================
# エンドポイント
# ========================
@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/upload")
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


@app.post("/api/analysis-jobs", status_code=202)
def start_analysis_job(req: AnalyzeRequest):
    if req.file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="データを再アップロードしてください")
    with analysis_lock:
        if any(j["status"] in ("queued", "running", "cancelling") for j in analysis_jobs.values()):
            raise HTTPException(status_code=409, detail="実行中の分析が終わるまでお待ちください")
        # 完了済みの大きな結果を無制限に保持しない
        while len(analysis_jobs) >= 10:
            analysis_jobs.pop(next(iter(analysis_jobs)))
        job_id = str(uuid.uuid4())
        job = {"status": "queued", "progress": "待機中", "cancel": threading.Event()}
        analysis_jobs[job_id] = job

    def checkpoint(message):
        if job["cancel"].is_set():
            raise HTTPException(status_code=409, detail="分析をキャンセルしました")
        job["progress"] = message

    def work():
        try:
            job["status"] = "running"
            checkpoint("開始中")
            result = _analyze(req, checkpoint)
            job.update(status="completed", result=result, progress="完了")
        except Exception as exc:
            if job["cancel"].is_set():
                job.update(status="cancelled", progress="キャンセル済み")
            else:
                job.update(status="failed", error=str(getattr(exc, "detail", exc)))

    analysis_pool.submit(work)
    return {"job_id": job_id}


@app.get("/api/analysis-jobs/{job_id}")
def get_analysis_job(job_id: str):
    job = analysis_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="分析ジョブが見つかりません")
    return {k: v for k, v in job.items() if k != "cancel"}


@app.delete("/api/analysis-jobs/{job_id}")
def cancel_analysis_job(job_id: str):
    job = analysis_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="分析ジョブが見つかりません")
    if job["status"] in ("queued", "running", "cancelling"):
        job["cancel"].set()
        job["status"] = "cancelling"
        job["progress"] = "現在の学習処理が終了したら停止します"
    return {"status": job["status"]}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    return _analyze(req)


def _loo_predictions(model, X, y, checkpoint, stage):
    from sklearn.base import clone
    predictions = np.empty(len(y))
    for i, (train, test) in enumerate(LeaveOneOut().split(X)):
        checkpoint(f"{stage}: {i}/{len(y)}件")
        estimator = clone(model)
        estimator.fit(X[train], y[train])
        predictions[test] = estimator.predict(X[test])
    checkpoint(f"{stage}: {len(y)}/{len(y)}件")
    return predictions


def _analyze(req: AnalyzeRequest, checkpoint=lambda message: None):
    """ランダムフォレスト回帰分析を実行する"""
    if req.file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="データが見つかりません．再アップロードしてください")

    df = uploaded_data[req.file_id]
    diagnosis = workspace.inspect_data(df, req.target_column, req.feature_columns)
    if diagnosis["errors"]:
        raise HTTPException(status_code=400, detail=" / ".join(diagnosis["errors"]))
    if not req.feature_columns or len(set(req.feature_columns)) != len(req.feature_columns):
        raise HTTPException(status_code=400, detail="重複のない説明変数を選択してください")

    # バリデーション
    missing = [c for c in req.feature_columns + [req.target_column] if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"存在しないカラム: {missing}")

    if not pd.api.types.is_numeric_dtype(df[req.target_column]):
        raise HTTPException(status_code=400, detail="目的変数は数値型である必要があります")

    try:
        X, y, label_encoders, df_work = preprocess_dataframe(
            df, req.feature_columns, req.target_column
        )

        if len(X) < 10:
            raise HTTPException(status_code=400, detail="有効なデータが10件未満です．データを確認してください")

        # ハイパーパラメータ決定（Optuna最適化 or 手動指定）
        best_params = None
        if req.optimize:
            best_params = optimize_hyperparams(
                X, y,
                random_state=req.random_state,
                n_trials=req.n_trials,
                metric=req.optimize_metric,
                checkpoint=checkpoint,
            )
            model_params = {k: v for k, v in best_params.items()
                            if k not in ("best_cv_score", "metric")}
        else:
            model_params = {
                "n_estimators": req.n_estimators,
                "max_depth": req.max_depth,
                "min_samples_split": req.min_samples_split,
                "min_samples_leaf": req.min_samples_leaf,
            }

        model = RandomForestRegressor(
            **model_params,
            random_state=req.random_state,
            n_jobs=-1,
        )

        # Leave-One-Out CV：全サンプルのout-of-fold予測を集めて全体で評価する
        loo = LeaveOneOut()
        y_oof = _loo_predictions(model, X, y, checkpoint, "交差検証")

        metrics = {
            "cv": {
                "method": "loo",
                "n_samples": int(len(X)),
                "r2":   float(r2_score(y, y_oof)),
                "rmse": float(np.sqrt(mean_squared_error(y, y_oof))),
                "mae":  float(mean_absolute_error(y, y_oof)),
            }
        }
        if np.all(y != 0):
            metrics["cv"]["mape"] = float(mean_absolute_percentage_error(y, y_oof))

        # 全データで最終モデルを学習
        checkpoint("最終モデルを学習中")
        model.fit(X, y)

        # 特徴量重要度
        importances = model.feature_importances_
        feature_importance = sorted(
            [
                {"feature": req.feature_columns[i], "importance": float(importances[i])}
                for i in range(len(req.feature_columns))
            ],
            key=lambda x: x["importance"],
            reverse=True,
        )

        # 残差分布
        residuals = y - y_oof
        residual_stats = {
            "mean": float(residuals.mean()),
            "std": float(residuals.std()),
            "min": float(residuals.min()),
            "max": float(residuals.max()),
        }

        # SHAP値の計算（全データから最大200件）
        top_n = min(req.shap_top_n, len(req.feature_columns))
        checkpoint("SHAPを計算中")
        explainer = shap.TreeExplainer(model)
        shap_X = X[:200]
        shap_vals = explainer.shap_values(shap_X)

        mean_abs_shap = np.abs(shap_vals).mean(axis=0)
        top_indices = np.argsort(mean_abs_shap)[::-1][:top_n]

        shap_importance = [
            {"feature": req.feature_columns[i], "mean_abs_shap": float(mean_abs_shap[i])}
            for i in top_indices
        ]

        rng = np.random.default_rng(77)
        beeswarm = []
        for rank, feat_idx in enumerate(top_indices):
            feat_name = req.feature_columns[feat_idx]
            sv = shap_vals[:, feat_idx]
            fv = shap_X[:, feat_idx]
            fv_min, fv_max = fv.min(), fv.max()
            fv_norm = (fv - fv_min) / (fv_max - fv_min + 1e-9)
            jitter = rng.uniform(-0.35, 0.35, size=len(sv))
            for s, fn, j in zip(sv, fv_norm, jitter):
                beeswarm.append({
                    "feature": feat_name,
                    "feature_rank": rank,
                    "shap": float(s),
                    "value_norm": float(fn),
                    "y": float(rank + j),
                })

        shap_data = {"importance": shap_importance, "beeswarm": beeswarm}

        checkpoint("完了処理中")
        result = {
            "model_id": str(uuid.uuid4()),
            "trained_params": {k: model.get_params()[k] for k in model_store.PREDICTION_PARAMS},
            "metrics": metrics,
            "feature_importance": feature_importance,
            "residual_stats": residual_stats,
            "best_params": best_params,
            "shap": shap_data,
            "data_info": {
                "total_rows": len(df_work),
                "cv_method": "Leave-One-Out CV",
                "features_used": req.feature_columns,
                "target": req.target_column,
                "encoded_columns": list(label_encoders.keys()),
            },
        }
        artifact = model_store.pack_model(
            model, label_encoders, req.feature_columns, req.target_column,
            req.model_dump(), workspace.dataset_fingerprint(df), result,
        )
        checkpoint("モデルの保存準備が完了")
        trained_models[req.file_id] = (model, label_encoders, req.feature_columns)
        model_artifacts[req.file_id] = artifact
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析中にエラーが発生: {str(e)}")




@app.post("/api/predict_marginal_fast")
async def predict_marginal_fast(req: PredictMarginalRequest):
    """キャッシュ済みモデルで限界効果を高速計算する（再学習なし）"""
    if req.file_id not in trained_models:
        raise HTTPException(status_code=404, detail="モデルが見つかりません．先に分析を実行してください")

    model, label_encoders, feature_columns = trained_models[req.file_id]
    artifact = model_artifacts.get(req.file_id)
    if (artifact is None or req.target_column != artifact.metadata["target"]
            or req.feature_columns != feature_columns
            or (req.model_id is not None and req.model_id != artifact.metadata["id"])):
        raise HTTPException(409, "選択中の分析条件とモデルが一致しません。履歴を開き直すか再分析してください。")
    if not set(req.changed_features).issubset(feature_columns):
        raise HTTPException(400, "モデルに含まれない変数が指定されています")

    def build_input(values: dict) -> list:
        row = []
        for col in feature_columns:
            default = label_encoders[col].classes_[0] if col in label_encoders else 0
            v = values.get(col, req.baseline_input.get(col, default))
            if col in label_encoders:
                v = label_encoders[col].transform([str(v)])[0]
            row.append(float(v))
        return row

    try:
        inputs = [build_input(req.baseline_input), build_input(req.sim_input)]
        for feat in req.changed_features:
            single = dict(req.baseline_input)
            single[feat] = req.sim_input[feat]
            inputs.append(build_input(single))
        # 同じ入力の差分に並列集計の丸め差が出ないよう、同一バッチで予測する。
        predictions = model.predict(inputs)
        baseline_pred, sim_pred = float(predictions[0]), float(predictions[1])
        marginal_effects = []
        for feat, pred in zip(req.changed_features, predictions[2:]):
            marginal_effects.append({
                "feature": feat,
                "effect": float(pred) - baseline_pred,
                "from_val": float(req.baseline_input.get(feat, 0)),
                "to_val": float(req.sim_input.get(feat, 0)),
            })

        return {
            "baseline": baseline_pred,
            "fixed_categories": {c: str(encoder.classes_[0]) for c, encoder in label_encoders.items() if c not in req.baseline_input},
            "simulation": sim_pred,
            "delta": sim_pred - baseline_pred,
            "marginal_effects": marginal_effects,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"高速予測中にエラーが発生: {str(e)}")


@app.post("/api/predict_marginal")
async def predict_marginal(req: PredictMarginalRequest):
    """ベースライン予測と各特徴量の限界効果を返す"""
    if req.file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="データが見つかりません．再アップロードしてください")

    df = uploaded_data[req.file_id]

    try:
        X_train, y_train, label_encoders, _ = preprocess_dataframe(
            df, req.feature_columns, req.target_column
        )

        model = RandomForestRegressor(
            n_estimators=req.n_estimators,
            max_depth=req.max_depth,
            min_samples_split=req.min_samples_split,
            min_samples_leaf=req.min_samples_leaf,
            max_features=req.max_features,
            random_state=req.random_state,
            n_jobs=-1,
        )
        model.fit(X_train, y_train)

        def build_input(values: dict) -> list:
            row = []
            for col in req.feature_columns:
                v = values.get(col, req.baseline_input.get(col, 0))
                if col in label_encoders:
                    v = label_encoders[col].transform([str(v)])[0]
                row.append(float(v))
            return row

        baseline_pred = float(model.predict([build_input(req.baseline_input)])[0])
        sim_pred = float(model.predict([build_input(req.sim_input)])[0])

        # 各変更特徴量の限界効果（他はベースライン固定）
        marginal_effects = []
        for feat in req.changed_features:
            single = dict(req.baseline_input)
            single[feat] = req.sim_input[feat]
            pred = float(model.predict([build_input(single)])[0])
            marginal_effects.append({
                "feature": feat,
                "effect": pred - baseline_pred,
                "from_val": float(req.baseline_input.get(feat, 0)),
                "to_val": float(req.sim_input.get(feat, 0)),
            })

        return {
            "baseline": baseline_pred,
            "simulation": sim_pred,
            "delta": sim_pred - baseline_pred,
            "marginal_effects": marginal_effects,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"限界効果計算中にエラーが発生: {str(e)}")


def to_python(v):
    """numpy型をPythonネイティブ型に変換する"""
    if pd.isna(v) or (isinstance(v, (float, np.floating)) and not np.isfinite(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def _run_test_prediction(df_train, df_test, target_column, feature_columns, params: dict) -> dict:
    """学習データで学習し，テストデータを予測して指標・結果テーブルを返す共通処理"""
    X_train, y_train, label_encoders, _ = preprocess_dataframe(
        df_train, feature_columns, target_column
    )

    model = RandomForestRegressor(
        n_estimators=params.get("n_estimators", 100),
        max_depth=params.get("max_depth"),
        min_samples_split=params.get("min_samples_split", 2),
        min_samples_leaf=params.get("min_samples_leaf", 1),
        max_features=params.get("max_features"),
        random_state=params.get("random_state", 77),
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # テストデータの特徴量を整形
    df_test_work = df_test[feature_columns].copy()
    for col in feature_columns:
        if col in label_encoders:
            df_test_work[col] = label_encoders[col].transform(
                df_test_work[col].astype(str)
            )
    X_test = df_test_work.values.astype(float)

    predictions = model.predict(X_test).tolist()

    # 目的変数がテストデータに含まれる場合は精度指標を計算
    metrics = None
    actuals = None
    if target_column in df_test.columns and pd.api.types.is_numeric_dtype(df_test[target_column]):
        y_test = df_test[target_column].values.astype(float)
        actuals = y_test.tolist()
        metrics = {
            "r2": float(1 - np.sum((y_test - np.array(predictions)) ** 2) / np.sum((y_test - y_test.mean()) ** 2)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, predictions))),
            "mae": float(mean_absolute_error(y_test, predictions)),
        }
        if np.all(y_test != 0):
            metrics["mape"] = float(mean_absolute_percentage_error(y_test, predictions))

    # 結果テーブル
    rows = []
    for i, pred in enumerate(predictions):
        row = {col: to_python(df_test.iloc[i][col]) for col in df_test.columns}
        row["__predicted__"] = float(pred)
        if actuals is not None:
            row["__actual__"] = float(actuals[i])
        rows.append(row)

    return {
        "predictions": predictions,
        "actuals": actuals,
        "metrics": metrics,
        "rows": rows,
        "has_actual": actuals is not None,
    }


@app.post("/api/predict_test")
async def predict_test(req: PredictTestRequest):
    """テストデータ全件を予測し，目的変数があれば精度指標も返す"""
    if req.train_file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="学習データが見つかりません．再アップロードしてください")
    if req.test_file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="テストデータが見つかりません．再アップロードしてください")

    df_train = uploaded_data[req.train_file_id]
    df_test = uploaded_data[req.test_file_id]

    missing = [c for c in req.feature_columns if c not in df_test.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"テストデータに存在しないカラム: {missing}")

    try:
        return _run_test_prediction(
            df_train, df_test, req.target_column, req.feature_columns, req.model_dump()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"テストデータ予測中にエラーが発生: {str(e)}")


@app.get("/api/rows/{file_id}")
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


@app.post("/api/predict_split")
async def predict_split(req: PredictSplitRequest):
    """単一ファイルを行指定で学習/テストに分割して予測する"""
    if req.file_id not in uploaded_data:
        raise HTTPException(status_code=404, detail="データが見つかりません．再アップロードしてください")

    df = uploaded_data[req.file_id]
    n = len(df)

    # インデックスの検証（重複除去・範囲チェック）
    test_idx = sorted(set(req.test_indices))
    if not test_idx:
        raise HTTPException(status_code=400, detail="テストデータにする行を1つ以上選択してください")
    if any(i < 0 or i >= n for i in test_idx):
        raise HTTPException(status_code=400, detail="選択した行が範囲外です")
    if len(test_idx) >= n:
        raise HTTPException(status_code=400, detail="全行をテストにはできません．学習用の行を残してください")

    df_test = df.iloc[test_idx]
    df_train = df.drop(df.index[test_idx])

    try:
        return _run_test_prediction(
            df_train, df_test, req.target_column, req.feature_columns, req.model_dump()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分割予測中にエラーが発生: {str(e)}")


ALLOWED_MODELS = {"gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-5"}

class ExplainRequest(BaseModel):
    api_key: str
    model: str = "gpt-4o-mini"
    metrics: dict
    feature_importance: list
    shap_importance: list
    data_info: dict
    best_params: Optional[dict] = None
    residual_stats: dict


@app.post("/api/explain")
async def explain_results(req: ExplainRequest):
    """分析結果をGPTで日本語解説する"""
    api_key = req.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="APIキーを入力してください。")
    if req.model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"使用できないモデルです: {req.model}")

    cv = req.metrics.get("cv", {})
    top_features = req.feature_importance[:5]
    top_shap = req.shap_importance[:5]

    prompt = f"""あなたはデータ分析の専門家です。以下のランダムフォレスト回帰分析の結果を、自治体職員など非専門家にも分かりやすく日本語で解説してください。

## 分析対象
- 目的変数: {req.data_info.get('target', '不明')}
- 説明変数数: {len(req.data_info.get('features_used', []))}
- サンプル数: {req.data_info.get('total_rows', '不明')}
- 交差検証: {req.data_info.get('cv_method', 'Leave-One-Out CV')}

## モデル精度（Leave-One-Out CV による全件の out-of-fold 予測で算出）
- R²（決定係数）: {cv.get('r2', 0):.4f}
- RMSE: {cv.get('rmse', 0):.3g}
- MAE: {cv.get('mae', 0):.3g}

## 特徴量重要度 TOP5（Gini）
{chr(10).join(f"- {f['feature']}: {f['importance']:.3g}" for f in top_features)}

## SHAP重要度 TOP5
{chr(10).join(f"- {f['feature']}: {f['mean_abs_shap']:.3g}" for f in top_shap)}

## 残差統計
- 平均: {req.residual_stats.get('mean', 0):.3g}
- 標準偏差: {req.residual_stats.get('std', 0):.3g}

以下の点を含めて300〜500文字程度で解説してください：
1. モデルの当てはまり具合（R²の評価）
2. 目的変数に最も影響する特徴量とその解釈
3. 分析結果から読み取れる示唆や注意点"""

    from openai import AuthenticationError, RateLimitError, APIError

    client = AsyncOpenAI(api_key=api_key)
    try:
        response = await client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=800,
        )
    except AuthenticationError:
        raise HTTPException(status_code=401, detail="APIキーが無効です。正しいOpenAI APIキーを入力してください。")
    except RateLimitError:
        raise HTTPException(status_code=429, detail="APIのレート制限に達しました。しばらく待ってから再試行してください。")
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI APIエラー: {str(e)}")

    return {"explanation": response.choices[0].message.content}


# ========================
# AIアシスタント（役割別解説・RAGチャット・知識ベース）
# ========================
def _map_openai_error(e: Exception) -> HTTPException:
    """OpenAI例外をHTTPExceptionへ正規化する"""
    from openai import AuthenticationError, RateLimitError, APIError

    if isinstance(e, AuthenticationError):
        return HTTPException(status_code=401, detail="APIキーが無効です。正しいOpenAI APIキーを入力してください。")
    if isinstance(e, RateLimitError):
        return HTTPException(status_code=429, detail="APIのレート制限に達しました。しばらく待ってから再試行してください。")
    if isinstance(e, APIError):
        return HTTPException(status_code=502, detail=f"OpenAI APIエラー: {str(e)}")
    return HTTPException(status_code=500, detail=f"処理中にエラーが発生: {str(e)}")


def _validate_key_model(api_key: str, model: str) -> str:
    key = api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="APIキーを入力してください。")
    if model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"使用できないモデルです: {model}")
    return key


class ExplainRolesRequest(ExplainRequest):
    # 解説させる役割（賛成/中立/反対 など）。省略時は全役割。
    roles: list[str] = ["賛成", "中立", "反対"]


@app.post("/api/explain/roles")
async def explain_with_roles(req: ExplainRolesRequest):
    """分析結果を複数の役割（視点）から並列で解説する"""
    api_key = _validate_key_model(req.api_key, req.model)
    payload = {
        "metrics": req.metrics,
        "feature_importance": req.feature_importance,
        "shap_importance": req.shap_importance,
        "data_info": req.data_info,
        "best_params": req.best_params,
        "residual_stats": req.residual_stats,
    }
    client = AsyncOpenAI(api_key=api_key)
    try:
        explanations = await assistant.explain_with_roles(client, req.model, payload, req.roles)
    except Exception as e:
        raise _map_openai_error(e)
    return {"explanations": explanations}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    api_key: str
    model: str = "gpt-4o-mini"
    question: str
    history: list[ChatMessage] = []
    results: Optional[dict] = None  # 現在の分析結果（任意）
    screen_context: str = Field(default="", max_length=12000)


@app.post("/api/assistant/chat")
async def assistant_chat(req: ChatRequest):
    """知識ベース（RAG）と分析結果を踏まえて機能・指標の質問に回答する"""
    api_key = _validate_key_model(req.api_key, req.model)
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="質問を入力してください。")
    client = AsyncOpenAI(api_key=api_key)
    try:
        result = await assistant.chat(
            client, req.model, req.question,
            [m.model_dump() for m in req.history], req.results, req.screen_context,
        )
    except Exception as e:
        raise _map_openai_error(e)
    return result


class SynthesisRequest(BaseModel):
    api_key: str
    model: str = "gpt-4o-mini"
    results: dict
    explanations: list[dict] = Field(min_length=3, max_length=3)


@app.post("/api/explain/synthesis")
async def synthesis(req: SynthesisRequest):
    key = _validate_key_model(req.api_key, req.model)
    if {e.get("role") for e in req.explanations} != {"賛成", "中立", "反対"}:
        raise HTTPException(400, "3視点の解説が必要です")
    async with AsyncOpenAI(api_key=key) as client:
        try:
            summary = await assistant.synthesize(client, req.model, req.results, req.explanations)
        except Exception as e:
            raise _map_openai_error(e)
    return {"summary": summary}


@app.post("/api/knowledge/ingest")
async def knowledge_ingest(
    file: UploadFile = File(...),
    api_key: str = Form(...),
):
    """ドキュメント（PDF/Word/テキスト）を知識ベースに取り込む"""
    key = api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="APIキーを入力してください。")
    if not file.filename.lower().endswith((".pdf", ".docx", ".txt", ".md")):
        raise HTTPException(status_code=400, detail="PDF / Word(.docx) / テキスト(.txt, .md) を指定してください。")

    content = await file.read()
    try:
        text = rag.extract_text(file.filename, content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ファイルの読み取りに失敗しました: {str(e)}")
    if not text.strip():
        raise HTTPException(status_code=400, detail="本文を抽出できませんでした。")

    client = AsyncOpenAI(api_key=key)
    try:
        chunks = await rag.ingest(client, file.filename, text)
    except Exception as e:
        raise _map_openai_error(e)
    return {"doc_name": file.filename, "chunks": chunks}


@app.get("/api/knowledge/list")
async def knowledge_list():
    """登録済みドキュメント一覧を返す"""
    return {"documents": rag.list_documents()}


@app.delete("/api/knowledge/{doc_name}")
async def knowledge_delete(doc_name: str):
    """指定ドキュメントを知識ベースから削除する"""
    removed = rag.delete_document(doc_name)
    if removed == 0:
        raise HTTPException(status_code=404, detail="該当するドキュメントが見つかりません。")
    return {"doc_name": doc_name, "removed_chunks": removed}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BACKEND_PORT)
