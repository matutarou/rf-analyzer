"""分析、予測、AI機能のリクエストモデル。

ChatMessageはworkspace側の同名モデルと区別するOpenAPIの公開名を維持する。
"""

from typing import Optional

from pydantic import BaseModel, Field


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
    # シミュレーション対象の行（0始まり）。指定するとその行を除いて学習したモデルで予測する
    exclude_row: Optional[int] = None



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



class ExplainRequest(BaseModel):
    api_key: str
    model: str = "gpt-4o-mini"
    metrics: dict
    feature_importance: list
    shap_importance: list
    data_info: dict
    best_params: Optional[dict] = None
    residual_stats: dict



class ExplainRolesRequest(ExplainRequest):
    # 解説させる役割（賛成/中立/反対 など）。省略時は全役割。
    roles: list[str] = ["賛成", "中立", "反対"]



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



class SynthesisRequest(BaseModel):
    api_key: str
    model: str = "gpt-4o-mini"
    results: dict
    explanations: list[dict] = Field(min_length=3, max_length=3)


ChatMessage.__module__ = "main"
ChatMessage.model_rebuild(force=True)
ChatRequest.model_rebuild(force=True)
