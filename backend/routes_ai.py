"""AI解説、チャット、知識ベースのエンドポイント。"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from openai import AsyncOpenAI

import assistant
import rag
from schemas import ExplainRequest, ExplainRolesRequest, ChatRequest, SynthesisRequest


router = APIRouter(prefix="/api")

ALLOWED_MODELS = {"gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-5"}


@router.post("/explain")
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



@router.post("/explain/roles")
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



@router.post("/assistant/chat")
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



@router.post("/explain/synthesis")
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



@router.post("/knowledge/ingest")
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



@router.get("/knowledge/list")
async def knowledge_list():
    """登録済みドキュメント一覧を返す"""
    return {"documents": rag.list_documents()}



@router.delete("/knowledge/{doc_name}")
async def knowledge_delete(doc_name: str):
    """指定ドキュメントを知識ベースから削除する"""
    removed = rag.delete_document(doc_name)
    if removed == 0:
        raise HTTPException(status_code=404, detail="該当するドキュメントが見つかりません。")
    return {"doc_name": doc_name, "removed_chunks": removed}
