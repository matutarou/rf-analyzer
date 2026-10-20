"""データフレームの前処理と値の変換。"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder


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



def to_python(v):
    """numpy型をPythonネイティブ型に変換する"""
    if pd.isna(v) or (isinstance(v, (float, np.floating)) and not np.isfinite(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v
