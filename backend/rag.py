"""軽量RAG（検索拡張）モジュール

OpenAIの埋め込みベクトルを numpy で保持し、ファイルに永続化する。
ローカル少人数利用が前提のため、外部ベクトルDBは使わずコサイン類似度で検索する。
アプリの機能・統計指標を説明するための知識ベースとして使う。
"""
from __future__ import annotations

import io
import os
import pickle
from dataclasses import dataclass, field

import numpy as np
from openai import AsyncOpenAI

EMBED_MODEL = "text-embedding-3-small"
STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "knowledge.pkl")

CHUNK_SIZE = 800   # 1チャンクの目安文字数
CHUNK_OVERLAP = 150  # チャンク間の重なり（文脈の断絶を防ぐ）
MIN_SIMILARITY = 0.4  # 実資料の検索評価で調整する暫定閾値


@dataclass
class Chunk:
    doc_name: str
    index: int
    text: str
    embedding: np.ndarray = field(repr=False)
    page: int | None = None


# ── 永続化 ──────────────────────────────────────────────
def _load() -> list[Chunk]:
    if not os.path.exists(STORE_PATH):
        return []
    with open(STORE_PATH, "rb") as f:
        return pickle.load(f)


def _save(chunks: list[Chunk]) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, "wb") as f:
        pickle.dump(chunks, f)


# ── ドキュメントからのテキスト抽出 ───────────────────────
def extract_text(filename: str, content: bytes) -> str:
    """PDF / Word / プレーンテキストから本文を抽出する"""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        return "\f".join((page.extract_text() or "") for page in reader.pages)
    if lower.endswith(".docx"):
        import docx

        doc = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs)
    # .txt / .md など
    for enc in ("utf-8", "shift_jis", "cp932"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def _chunk_text(text: str) -> list[str]:
    """重なりを持たせて文字数ベースでチャンク分割する"""
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


# ── 埋め込み ────────────────────────────────────────────
async def _embed(client: AsyncOpenAI, texts: list[str]) -> list[np.ndarray]:
    resp = await client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [np.array(d.embedding, dtype=np.float32) for d in resp.data]


# ── 公開API ─────────────────────────────────────────────
async def ingest(client: AsyncOpenAI, doc_name: str, text: str) -> int:
    """テキストをチャンク化・埋め込みして知識ベースに追加する。追加チャンク数を返す。"""
    sections = text.split("\f")
    paginated = doc_name.lower().endswith(".pdf")
    located = [(piece, page if paginated else None)
               for page, section in enumerate(sections, 1) for piece in _chunk_text(section)]
    pieces = [piece for piece, page in located]
    if not pieces:
        return 0

    embeddings = await _embed(client, pieces)
    store = _load()
    # 同名ドキュメントは一旦削除してから入れ直す（再アップロード対応）
    store = [c for c in store if c.doc_name != doc_name]
    for i, (piece, emb) in enumerate(zip(pieces, embeddings)):
        store.append(Chunk(doc_name=doc_name, index=i, text=piece, embedding=emb, page=located[i][1]))
    _save(store)
    return len(pieces)


async def search(client: AsyncOpenAI, query: str, top_k: int = 4) -> list[dict]:
    """クエリに近いチャンクを上位top_k件返す。知識ベースが空なら空リスト。"""
    store = _load()
    if not store:
        return []

    q_emb = (await _embed(client, [query]))[0]
    matrix = np.vstack([c.embedding for c in store])
    # コサイン類似度
    sims = matrix @ q_emb / (
        np.linalg.norm(matrix, axis=1) * np.linalg.norm(q_emb) + 1e-9
    )
    top_idx = np.argsort(sims)[::-1][:top_k]
    return [
        {"doc_name": store[i].doc_name, "chunk": store[i].index + 1,
         "page": getattr(store[i], "page", None),
         "text": store[i].text, "score": float(sims[i])}
        for i in top_idx if sims[i] >= MIN_SIMILARITY
    ]


def list_documents() -> list[dict]:
    """登録済みドキュメントの一覧（名前とチャンク数）を返す"""
    store = _load()
    counts: dict[str, int] = {}
    for c in store:
        counts[c.doc_name] = counts.get(c.doc_name, 0) + 1
    return [{"doc_name": name, "chunks": n} for name, n in counts.items()]


def delete_document(doc_name: str) -> int:
    """指定ドキュメントを削除し、削除したチャンク数を返す"""
    store = _load()
    remaining = [c for c in store if c.doc_name != doc_name]
    removed = len(store) - len(remaining)
    _save(remaining)
    return removed
