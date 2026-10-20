"""データ、学習済みモデル、分析ジョブの共有状態。"""

import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

import model_store


# アップロードされたデータを一時保存（本番ではDB/キャッシュを使用）
uploaded_data: dict[str, pd.DataFrame] = {}
trained_models: dict[str, tuple] = {}  # file_id -> (model, label_encoders, feature_columns)
model_artifacts: dict[str, model_store.ModelArtifact] = {}


UPLOAD_DIR = tempfile.mkdtemp()
analysis_jobs = {}
analysis_lock = threading.Lock()
analysis_pool = ThreadPoolExecutor(max_workers=1)
