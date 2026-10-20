"""学習済みモデルの限界効果とテストデータの予測。"""

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    mean_absolute_percentage_error,
)

from preprocessing import preprocess_dataframe, to_python
from schemas import PredictMarginalRequest, PredictTestRequest, PredictSplitRequest
from state import uploaded_data, trained_models, model_artifacts


router = APIRouter(prefix="/api")


@router.post("/predict_marginal_fast")
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



@router.post("/predict_marginal")
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



@router.post("/predict_test")
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



@router.post("/predict_split")
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
