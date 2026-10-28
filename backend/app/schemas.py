from pydantic import BaseModel, ConfigDict, Field


class APIModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class MetadataIn(APIModel):
    time: str
    version: str
    subject: str
    owner: str
    keywords: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)


class MetadataOut(MetadataIn):
    pass


class KnowledgeBaseCreate(APIModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    owner: str = ""
    embedding_model: str | None = Field(default=None, alias="embeddingModel")
    tags: list[str] = Field(default_factory=list)


class KnowledgeBaseUpdate(APIModel):
    name: str | None = None
    description: str | None = None
    owner: str | None = None
    status: str | None = None
    tags: list[str] | None = None


class KnowledgeBaseOut(APIModel):
    id: str
    name: str
    description: str
    status: str
    document_count: int = Field(serialization_alias="documentCount")
    chunk_count: int = Field(serialization_alias="chunkCount")
    embedding_model: str = Field(serialization_alias="embeddingModel")
    updated_at: str = Field(serialization_alias="updatedAt")
    owner: str
    tags: list[str]


class DocumentOut(APIModel):
    id: str
    name: str
    format: str
    size: str
    status: str
    chunks: int
    parser: str
    updated_at: str = Field(serialization_alias="updatedAt")
    error_reason: str | None = Field(default=None, serialization_alias="errorReason")
    metadata: MetadataOut


class ChunkOut(APIModel):
    id: str
    title: str
    content: str
    source: str
    locator: str
    enabled: bool
    tokens: int


class ImportTaskOut(APIModel):
    id: str
    knowledge_base_id: str = Field(serialization_alias="knowledgeBaseId")
    knowledge_base: str = Field(serialization_alias="knowledgeBase")
    document_id: str | None = Field(default=None, serialization_alias="documentId")
    file_name: str = Field(serialization_alias="fileName")
    stage: str
    status: str
    progress: int
    error: str | None = None
    updated_at: str = Field(serialization_alias="updatedAt")


class UploadOut(APIModel):
    document: DocumentOut
    task: ImportTaskOut


class RetrievalIn(APIModel):
    query: str = Field(min_length=1)
    mode: str = "hybrid"
    top_k: int = Field(default=5, alias="topK", ge=1, le=20)


class RetrievalHit(APIModel):
    id: str
    title: str
    content: str
    source: str
    locator: str
    dense_score: float = Field(serialization_alias="denseScore")
    keyword_score: float = Field(serialization_alias="keywordScore")
    rerank_score: float = Field(serialization_alias="rerankScore")
    sufficient: bool


class ChatIn(APIModel):
    message: str = Field(min_length=1)
    knowledge_base_ids: list[str] = Field(alias="knowledgeBaseIds", min_length=1)
    conversation_id: str | None = Field(default=None, alias="conversationId")
    scenario_id: str | None = Field(default=None, alias="scenarioId")


class ProviderIn(APIModel):
    provider: str
    capability: str
    name: str
    model: str
    endpoint: str


class ProviderOut(APIModel):
    id: str
    provider: str
    capability: str
    name: str
    model: str
    endpoint: str
    status: str
    latency_ms: int | None = Field(default=None, serialization_alias="latencyMs")
    dimension: int | None = None
    last_checked: str | None = Field(default=None, serialization_alias="lastChecked")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")


class RoleOut(APIModel):
    id: str
    name: str
    description: str
    permissions: list[str]


class QueryLogOut(APIModel):
    id: str
    trace_id: str = Field(serialization_alias="traceId")
    query: str
    knowledge_base: str = Field(serialization_alias="knowledgeBase")
    model: str
    provider: str
    status: str
    input_tokens: int = Field(serialization_alias="inputTokens")
    output_tokens: int = Field(serialization_alias="outputTokens")
    duration_ms: int = Field(serialization_alias="durationMs")
    retrieval_ms: int = Field(serialization_alias="retrievalMs")
    rerank_ms: int = Field(serialization_alias="rerankMs")
    first_token_ms: int = Field(serialization_alias="firstTokenMs")
    created_at: str = Field(serialization_alias="createdAt")
    scenario_id: str | None = Field(default=None, serialization_alias="scenarioId")
