"""バックエンドとフロントエンドのポート設定。"""

import os


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



BACKEND_PORT = resolve_port("RF_BACKEND_PORT", 8780)
FRONTEND_PORT = resolve_port("RF_FRONTEND_PORT", 5280)
