"""分析ジョブの管理とランダムフォレスト回帰分析。"""

import threading
import uuid

import numpy as np
import optuna
import pandas as pd
import shap
from fastapi import APIRouter, HTTPException
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import LeaveOneOut
from sklearn.metrics import (
    r2_score,
    mean_squared_error,
    mean_absolute_error,
    mean_absolute_percentage_error,
)

import model_store
import workspace
from preprocessing import preprocess_dataframe
from schemas import AnalyzeRequest
from state import (
    uploaded_data,
    trained_models,
    model_artifacts,
    analysis_jobs,
    analysis_lock,
    analysis_pool,
)


optuna.logging.set_verbosity(optuna.logging.WARNING)

router = APIRouter(prefix="/api")

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



def optimization_history(values, direction="maximize"):
    """Optunaの試行ごとのスコアと、その時点までの最良スコアの推移を返す"""
    history, best = [], None
    for number, value in enumerate(values, start=1):
        if value is not None and np.isfinite(value):
            best = value if best is None else (max(best, value) if direction == "maximize" else min(best, value))
        history.append({"trial": number, "value": None if value is None or not np.isfinite(value) else float(value),
                        "best": None if best is None else float(best)})
    return history


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
        "history": optimization_history([t.value for t in study.trials], direction),
    }



@router.post("/analysis-jobs", status_code=202)
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



@router.get("/analysis-jobs/{job_id}")
def get_analysis_job(job_id: str):
    job = analysis_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="分析ジョブが見つかりません")
    return {k: v for k, v in job.items() if k != "cancel"}



@router.delete("/analysis-jobs/{job_id}")
def cancel_analysis_job(job_id: str):
    job = analysis_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="分析ジョブが見つかりません")
    if job["status"] in ("queued", "running", "cancelling"):
        job["cancel"].set()
        job["status"] = "cancelling"
        job["progress"] = "現在の学習処理が終了したら停止します"
    return {"status": job["status"]}



@router.post("/analyze")
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
        history = None
        if req.optimize:
            best_params = optimize_hyperparams(
                X, y,
                random_state=req.random_state,
                n_trials=req.n_trials,
                metric=req.optimize_metric,
                checkpoint=checkpoint,
            )
            # 推移は結果に別項目として返し、モデルのパラメータには含めない
            history = best_params.pop("history")
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
            "optimization_history": history,
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
