"""アプリが学習したモデルを、分析条件と結び付けて保存する。"""
import hashlib
import json
import sys
from dataclasses import dataclass
from importlib.metadata import version
from zipfile import ZIP_DEFLATED

import skops.io
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder


TRAINING_DEFAULTS = {
    "optimize": False, "n_trials": 50, "optimize_metric": "r2",
    "n_estimators": 100, "max_depth": None, "min_samples_split": 2,
    "min_samples_leaf": 1, "random_state": 77,
}
PREDICTION_PARAMS = (
    "n_estimators", "max_depth", "min_samples_split", "min_samples_leaf",
    "max_features", "random_state",
)


def runtime_versions():
    return {"python": f"{sys.version_info.major}.{sys.version_info.minor}",
            **{name: version(name) for name in ("scikit-learn", "numpy", "scipy", "skops")}}


def training_settings(params):
    return {key: params.get(key, default) for key, default in TRAINING_DEFAULTS.items()}


def result_digest(results):
    # ブラウザのJSON往復では1.0が1になるため、同じ数値として照合する。
    def normalize(value):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {k: normalize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [normalize(v) for v in value]
        return value
    text = json.dumps(normalize(results), sort_keys=True, ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(text.encode()).hexdigest()


class ModelUnavailable(ValueError):
    pass


@dataclass
class ModelArtifact:
    metadata: dict
    payload: bytes
    digest: str

    def matches(self, fingerprint, target, features, params, results):
        m = self.metadata
        return bool(results and m.get("id") == results.get("model_id")
                    and m.get("fingerprint") == fingerprint and m.get("target") == target
                    and m.get("features") == features
                    and m.get("settings") == training_settings(params)
                    and m.get("results_digest") == result_digest(results))


def pack_model(model, encoders, features, target, params, fingerprint, results):
    metadata = {
        "format": 1, "preprocessing": 1, "id": results["model_id"],
        "fingerprint": fingerprint, "target": target, "features": list(features),
        "settings": training_settings(params), "trained_params": results["trained_params"],
        "results_digest": result_digest(results), "versions": runtime_versions(),
    }
    payload = skops.io.dumps({"model": model, "encoders": encoders, "metadata": metadata},
                            compression=ZIP_DEFLATED, compresslevel=3)
    return ModelArtifact(metadata, payload, hashlib.sha256(payload).hexdigest())


def unpack_model(artifact):
    metadata = artifact.metadata
    if hashlib.sha256(artifact.payload).hexdigest() != artifact.digest:
        raise ModelUnavailable("保存モデルが破損しています。分析結果は復元しましたが、モデルは再分析が必要です。")
    if (metadata.get("format") != 1 or metadata.get("preprocessing") != 1
            or metadata.get("versions") != runtime_versions()):
        raise ModelUnavailable("保存時と実行環境のバージョンが異なるため、モデルは再分析が必要です。")
    try:
        # 未知の型を自動で信頼しない。外部モデルを受け入れるAPIも設けない。
        bundle = skops.io.loads(artifact.payload, trusted=[])
        model, encoders = bundle["model"], bundle["encoders"]
        if (bundle["metadata"] != metadata or type(model) is not RandomForestRegressor
                or type(encoders) is not dict or any(type(e) is not LabelEncoder for e in encoders.values())
                or not set(encoders).issubset(metadata["features"])
                or model.n_features_in_ != len(metadata["features"])
                or {k: model.get_params()[k] for k in PREDICTION_PARAMS} != metadata["trained_params"]):
            raise ValueError("モデルの構造が一致しません")
        return model, encoders, list(metadata["features"])
    except Exception as error:
        raise ModelUnavailable("保存モデルを検証・復元できませんでした。モデルは再分析が必要です。") from error
