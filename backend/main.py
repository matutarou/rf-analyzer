"""
自治体データ ランダムフォレスト回帰分析 API
FastAPI backend
"""

from fastapi import FastAPI, HTTPException as HTTPException
from fastapi.middleware.cors import CORSMiddleware

import workspace
import routes_data
import routes_analysis
import routes_predict
import routes_ai
from config import (
    BACKEND_PORT as BACKEND_PORT,
    FRONTEND_PORT as FRONTEND_PORT,
    resolve_port as resolve_port,
)
from state import (
    uploaded_data as uploaded_data,
    trained_models as trained_models,
    model_artifacts as model_artifacts,
    UPLOAD_DIR as UPLOAD_DIR,
    analysis_jobs as analysis_jobs,
    analysis_lock as analysis_lock,
    analysis_pool as analysis_pool,
)
from schemas import (
    AnalyzeRequest as AnalyzeRequest,
    PredictMarginalRequest as PredictMarginalRequest,
    PredictTestRequest as PredictTestRequest,
    PredictSplitRequest as PredictSplitRequest,
    ExplainRequest as ExplainRequest,
    ExplainRolesRequest as ExplainRolesRequest,
    ChatMessage as ChatMessage,
    ChatRequest as ChatRequest,
    SynthesisRequest as SynthesisRequest,
)
from preprocessing import (
    preprocess_dataframe as preprocess_dataframe,
    to_python as to_python,
)
from routes_data import (
    health_check as health_check,
    upload_csv as upload_csv,
    get_rows as get_rows,
)
from routes_analysis import (
    METRIC_CONFIG as METRIC_CONFIG,
    _score_by_metric as _score_by_metric,
    optimize_hyperparams as optimize_hyperparams,
    start_analysis_job as start_analysis_job,
    get_analysis_job as get_analysis_job,
    cancel_analysis_job as cancel_analysis_job,
    analyze as analyze,
    _loo_predictions as _loo_predictions,
    _analyze as _analyze,
)
from routes_predict import (
    predict_marginal_fast as predict_marginal_fast,
    predict_marginal as predict_marginal,
    _run_test_prediction as _run_test_prediction,
    predict_test as predict_test,
    predict_split as predict_split,
)
from routes_ai import (
    ALLOWED_MODELS as ALLOWED_MODELS,
    explain_results as explain_results,
    _map_openai_error as _map_openai_error,
    _validate_key_model as _validate_key_model,
    explain_with_roles as explain_with_roles,
    assistant_chat as assistant_chat,
    synthesis as synthesis,
    knowledge_ingest as knowledge_ingest,
    knowledge_list as knowledge_list,
    knowledge_delete as knowledge_delete,
)

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

app.include_router(workspace.create_router(uploaded_data, trained_models, model_artifacts))
app.include_router(routes_data.router)
app.include_router(routes_analysis.router)
app.include_router(routes_predict.router)
app.include_router(routes_ai.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BACKEND_PORT)
