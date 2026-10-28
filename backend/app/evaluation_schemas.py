from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Status = Literal["success", "partial", "failed", "running", "unknown", "waiting", "cancelled"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContextMessage(StrictModel):
    role: str = Field(max_length=40)
    content: str = Field(max_length=2_000_000)
    tokens: int = Field(default=0, ge=0)


class CodeAnnotation(StrictModel):
    lines: tuple[int, int]
    title: str = Field(max_length=200)
    detail: str = Field(max_length=4000)


class ExecutionSource(StrictModel):
    path: str = Field(max_length=512)
    revision: str = Field(max_length=160)
    language: str = Field(max_length=30)
    code: str = Field(max_length=200_000)
    annotations: list[CodeAnnotation] = Field(default_factory=list, max_length=200)


class TraceNode(StrictModel):
    id: str = Field(min_length=1, max_length=160)
    parent: str | None = Field(default=None, max_length=160)
    name: str = Field(min_length=1, max_length=200)
    type: Literal["agent", "llm", "tool", "skill", "retrieval", "context", "harness", "build"]
    status: Status
    start: int = Field(ge=0)
    duration: int = Field(ge=0)
    input: Any = None
    output: Any = None
    inputTokens: int | None = Field(default=None, ge=0)
    outputTokens: int | None = Field(default=None, ge=0)
    cachedTokens: int | None = Field(default=None, ge=0)
    cost: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    currency: Literal["CNY", "USD"] | None = None
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    error: str | None = Field(default=None, max_length=4000)
    attempt: int | None = Field(default=None, ge=1)
    events: list[str] = Field(default_factory=list, max_length=5000)
    context: list[ContextMessage] | None = None
    executionSource: ExecutionSource | None = None
    tokenSource: Literal["provider", "estimated", "none", "unknown"] | None = None

    @model_validator(mode="after")
    def currency_required(self):
        if self.cost is not None and self.cost > 0 and self.currency is None:
            raise ValueError("非零费用必须提供原币种，不能隐式换算")
        return self


class RunIn(StrictModel):
    id: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.:-]+$")
    traceId: str = Field(min_length=1, max_length=160)
    sessionId: str | None = Field(default=None, max_length=160)
    kind: Literal["agent", "build", "chat"]
    name: str = Field(min_length=1, max_length=200)
    version: str = Field(max_length=160)
    input: str = Field(max_length=2_000_000)
    output: str = Field(max_length=2_000_000)
    status: Status
    environment: Literal["local", "staging"] = "local"
    knowledge: str = Field(max_length=1000)
    startedAt: datetime
    duration: int = Field(ge=0)
    nodes: list[TraceNode] = Field(min_length=1, max_length=1000)
    issue: str | None = Field(default=None, max_length=4000)
    issueNode: str | None = Field(default=None, max_length=160)
    feedback: str | None = Field(default=None, max_length=4000)
    dataSource: Literal["captured", "reported", "historical"] = "reported"

    @model_validator(mode="after")
    def validate_tree(self):
        ids = {node.id for node in self.nodes}
        if len(ids) != len(self.nodes):
            raise ValueError("节点 ID 不能重复")
        parents = {node.id: node.parent for node in self.nodes}
        for node in self.nodes:
            seen = {node.id}
            parent = node.parent
            while parent is not None:
                if parent not in ids or parent in seen:
                    raise ValueError("调用链存在悬空父节点或循环")
                seen.add(parent)
                parent = parents[parent]
        if self.issueNode and self.issueNode not in ids:
            raise ValueError("异常节点不存在")
        if self.startedAt.tzinfo is None:
            raise ValueError("startedAt 必须包含时区")
        return self


class DatasetIn(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=500)

    @field_validator("name", "description", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value


class Annotation(StrictModel):
    datasetIds: list[str] = Field(min_length=1, max_length=100)
    label: Literal["goodcase", "badcase", "unlabeled"] = "unlabeled"
    reason: str = Field(default="", max_length=4000)
    expectedAnswer: str = Field(default="", max_length=12000)
    tags: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values):
        if any(len(v) > 80 for v in values):
            raise ValueError("标签不能超过 80 字")
        return list(dict.fromkeys(v.strip() for v in values if v.strip()))


class CaptureIn(Annotation):
    sourceRunId: str = Field(min_length=1, max_length=160)
    sourceTraceId: str = Field(min_length=1, max_length=160)


class AnnotationUpdate(Annotation):
    expectedRevision: int = Field(ge=1)


class BulkIn(StrictModel):
    caseIds: list[str] = Field(min_length=1, max_length=500)
    datasetId: str
