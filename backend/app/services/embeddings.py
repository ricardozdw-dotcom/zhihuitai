import hashlib
import math

from app.config import Settings, get_settings


def fake_embedding(text: str, dim: int) -> list[float]:
    vector = [0.0] * dim
    source = text.strip() or "empty"
    tokens = [source[index : index + 2] for index in range(max(len(source) - 1, 1))]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        slot = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[slot] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def embed_texts(texts: list[str], settings: Settings | None = None) -> list[list[float]]:
    current = settings or get_settings()
    if not texts:
        return []
    if current.embedding_configured:
        from langchain_openai import OpenAIEmbeddings

        client = OpenAIEmbeddings(
            model=current.embedding_model,
            api_key=current.embedding_api_key,
            base_url=current.embedding_base_url,
            dimensions=current.embedding_dim,
        )
        vectors = client.embed_documents(texts)
        for vector in vectors:
            if len(vector) != current.embedding_dim:
                raise RuntimeError(
                    f"Embedding 维度是 {len(vector)}，知识库锁定为 {current.embedding_dim}"
                )
        return vectors
    return [fake_embedding(text, current.embedding_dim) for text in texts]


def embed_query(text: str, settings: Settings | None = None) -> list[float]:
    current = settings or get_settings()
    if current.embedding_configured:
        from langchain_openai import OpenAIEmbeddings

        client = OpenAIEmbeddings(
            model=current.embedding_model,
            api_key=current.embedding_api_key,
            base_url=current.embedding_base_url,
            dimensions=current.embedding_dim,
        )
        vector = client.embed_query(text)
        if len(vector) != current.embedding_dim:
            raise RuntimeError(
                f"Embedding 维度是 {len(vector)}，知识库锁定为 {current.embedding_dim}"
            )
        return vector
    return fake_embedding(text, current.embedding_dim)
