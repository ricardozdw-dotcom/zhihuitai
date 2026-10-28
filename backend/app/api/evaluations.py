import copy
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.clock import now
from app.db import get_db
from app.evaluation_schemas import AnnotationUpdate, BulkIn, CaptureIn, DatasetIn, RunIn
from app.models import AuditEvent, EvaluationCase, EvaluationDataset, EvaluationMembership, ObservedRun
from app.services.observability import redact

router = APIRouter(prefix="/api", tags=["可观测与评测集"])
TERMINAL = {"success", "failed", "partial", "cancelled"}


def ids(values):
    try:
        return sorted({uuid.UUID(v) for v in values})
    except ValueError as exc:
        raise HTTPException(422, "无效的评测集或 Case ID") from exc


def dataset_out(item):
    return {"id": str(item.id), "name": item.name, "description": item.description, "createdAt": item.created_at.isoformat()}


def case_out(session, item):
    memberships = session.scalars(select(EvaluationMembership.dataset_id).where(EvaluationMembership.case_id == item.id).order_by(EvaluationMembership.dataset_id)).all()
    kind = item.snapshot["kind"]
    return {"id": str(item.id), "label": item.label, "reason": item.reason, "expectedAnswer": item.expected_answer,
            "tags": item.tags, "datasetIds": [str(v) for v in memberships], "createdAt": item.created_at.isoformat(),
            "updatedAt": item.updated_at.isoformat(), "revision": item.revision, "sourceRunId": item.source_run_id,
            "sourceTraceId": item.source_trace_id, "sourceKind": kind, "snapshot": item.snapshot,
            "sourceUrl": f"/observability/{'agents' if kind == 'agent' else 'conversations'}/{item.source_run_id}"}


def validate_datasets(session, dataset_ids):
    values = ids(dataset_ids)
    found = session.scalars(select(EvaluationDataset.id).where(EvaluationDataset.id.in_(values))).all()
    if not values or len(found) != len(values):
        raise HTTPException(422, "请选择至少一个有效的评测集")
    return values


def add_memberships(session, item, dataset_ids):
    existing = set(session.scalars(select(EvaluationMembership.dataset_id).where(EvaluationMembership.case_id == item.id)))
    added = set(dataset_ids) - existing
    for dataset_id in added:
        session.add(EvaluationMembership(case_id=item.id, dataset_id=dataset_id))
    if added:
        item.updated_at = now()
        item.revision += 1
    session.flush()
    return bool(added)


def audit(session, action, entity, detail=""):
    session.add(AuditEvent(action=action, entity_type="evaluation_case", entity_id=str(entity), detail=detail))


@router.get("/observability/runs")
def list_runs(session: Session = Depends(get_db), offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    rows = session.scalars(select(ObservedRun).order_by(ObservedRun.created_at.desc(), ObservedRun.id).offset(offset).limit(limit + 1)).all()
    return {"items": [row.payload for row in rows[:limit]], "nextOffset": offset + limit if len(rows) > limit else None}


@router.get("/observability/runs/{run_id}")
def get_run(run_id: str, session: Session = Depends(get_db)):
    row = session.get(ObservedRun, run_id)
    if not row:
        raise HTTPException(404, "原始运行日志不存在；已回流的 Case 快照仍可查看")
    return row.payload


@router.post("/observability/runs", summary="执行器上报完整运行记录（全量、顺序更新）")
def report_run(body: RunIn, session: Session = Depends(get_db)):
    # The runtime integration endpoint never accepts a client claim of locally captured provenance.
    payload = body.model_dump(mode="json", exclude_none=True)
    for index, node in enumerate(body.nodes):
        if node.cost is None and (node.type == "llm" or "cost" in node.model_fields_set):
            payload["nodes"][index]["cost"] = None
    payload["dataSource"] = "reported"
    payload = redact(payload)
    if len(json.dumps(payload, ensure_ascii=False).encode()) > 8 * 1024 * 1024:
        raise HTTPException(413, "运行记录超过 8 MB；请在执行器侧控制证据体积")
    statement = insert(ObservedRun).values(id=body.id, trace_id=body.traceId, kind=body.kind, status=body.status,
                                          payload=payload, created_at=body.startedAt, updated_at=now())
    session.execute(statement.on_conflict_do_nothing())
    row = session.scalar(select(ObservedRun).where(ObservedRun.id == body.id).with_for_update())
    if row is None or row.trace_id != body.traceId or row.kind != body.kind or row.payload.get("dataSource") != "reported":
        raise HTTPException(409, "运行 ID / Trace 冲突，不能覆盖平台采集的证据")
    if row.status in TERMINAL and row.payload != payload:
        raise HTTPException(409, "运行已经结束，不能修改原始证据")
    old_nodes = {n["id"]: n for n in row.payload["nodes"]}
    new_nodes = {n["id"]: n for n in payload["nodes"]}
    if body.duration < row.payload["duration"] or any(k not in new_nodes or (v["status"] in TERMINAL and v != new_nodes[k]) for k, v in old_nodes.items()):
        raise HTTPException(409, "上报必须按顺序保留已完成节点，不能回退或覆盖证据")
    row.payload, row.status, row.updated_at = payload, body.status, now()
    session.flush()
    return payload


@router.get("/evaluations/state")
def evaluation_state(session: Session = Depends(get_db)):
    datasets = session.scalars(select(EvaluationDataset).order_by(EvaluationDataset.created_at.desc())).all()
    cases = session.scalars(select(EvaluationCase).order_by(EvaluationCase.created_at.desc())).all()
    return {"version": 1, "datasets": [dataset_out(d) for d in datasets], "cases": [case_out(session, c) for c in cases]}


@router.post("/evaluations/datasets")
def create_dataset(body: DatasetIn, session: Session = Depends(get_db)):
    dataset_id = uuid.uuid4()
    inserted = session.scalar(insert(EvaluationDataset).values(id=dataset_id, name=body.name, description=body.description).on_conflict_do_nothing(index_elements=[EvaluationDataset.name]).returning(EvaluationDataset.id))
    if inserted is None:
        raise HTTPException(409, "已存在同名评测集")
    return dataset_out(session.get(EvaluationDataset, inserted))


@router.post("/evaluations/cases")
def capture_case(body: CaptureIn, session: Session = Depends(get_db)):
    datasets = validate_datasets(session, body.datasetIds)
    # Lock the authoritative source to serialize duplicate captures even from different processes.
    run = session.scalar(select(ObservedRun).where(ObservedRun.id == body.sourceRunId).with_for_update())
    if run is None or run.trace_id != body.sourceTraceId:
        raise HTTPException(404, "未找到匹配的原始运行日志")
    if run.kind == "build":
        raise HTTPException(422, "Case 回流支持对话与 Agent 请求，构建任务请在异常中心处理")
    if run.status not in TERMINAL:
        raise HTTPException(409, "运行尚未结束，请等待终态后回流完整快照")
    item = session.scalar(select(EvaluationCase).where(EvaluationCase.source_run_id == run.id, EvaluationCase.source_trace_id == run.trace_id).with_for_update())
    duplicate = item is not None
    if item is None:
        item = EvaluationCase(source_run_id=run.id, source_trace_id=run.trace_id, snapshot=copy.deepcopy(run.payload),
                              label=body.label, reason=body.reason, expected_answer=body.expectedAnswer, tags=body.tags,
                              revision=0, updated_at=now())
        session.add(item)
        session.flush()
    added = add_memberships(session, item, datasets)
    if not duplicate or added:
        audit(session, "case.capture" if not duplicate else "case.collect", item.id)
    return {"item": case_out(session, item), "duplicate": duplicate, "addedMembership": added}


@router.patch("/evaluations/cases/{case_id}")
def update_case(case_id: uuid.UUID, body: AnnotationUpdate, session: Session = Depends(get_db)):
    datasets = validate_datasets(session, body.datasetIds)
    item = session.scalar(select(EvaluationCase).where(EvaluationCase.id == case_id).with_for_update())
    if item is None:
        raise HTTPException(404, "Case 不存在")
    if item.revision != body.expectedRevision:
        raise HTTPException(409, "此 Case 已被其他操作更新，请刷新后重新编辑；本次内容未覆盖")
    item.label, item.reason, item.expected_answer, item.tags = body.label, body.reason, body.expectedAnswer, body.tags
    item.revision += 1
    item.updated_at = now()
    session.execute(delete(EvaluationMembership).where(EvaluationMembership.case_id == item.id))
    session.add_all([EvaluationMembership(case_id=item.id, dataset_id=v) for v in datasets])
    session.flush()
    audit(session, "case.annotate", item.id)
    return case_out(session, item)


@router.post("/evaluations/cases/bulk-collect")
def bulk_collect(body: BulkIn, session: Session = Depends(get_db)):
    dataset = validate_datasets(session, [body.datasetId])[0]
    case_ids = ids(body.caseIds)
    rows = session.scalars(select(EvaluationCase).where(EvaluationCase.id.in_(case_ids)).order_by(EvaluationCase.id).with_for_update()).all()
    if len(rows) != len(case_ids):
        raise HTTPException(404, "部分 Case 不存在，未执行批量归集")
    for item in rows:
        if add_memberships(session, item, [dataset]):
            audit(session, "case.collect", item.id, str(dataset))
    return {"updated": len(rows)}
