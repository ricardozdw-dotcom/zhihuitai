import copy
import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError

from app.clock import now
from app.db import SessionLocal
from app.main import app
from app.models import EvaluationCase, EvaluationDataset, ObservedRun

client = TestClient(app)


def create_dataset():
    response = client.post('/api/evaluations/datasets', json={'name': f'验收-{uuid.uuid4().hex[:12]}', 'description': '自动测试集合'})
    assert response.status_code == 200, response.text
    return response.json()['id']


def report_agent(status='success'):
    suffix = uuid.uuid4().hex
    payload = {'id': f'agent-{suffix}', 'traceId': suffix, 'sessionId': f'session-{suffix}', 'kind': 'agent',
               'name': '测试执行器上报', 'version': 'test-v1', 'input': '\n  请查询远程办公制度\n', 'output': '已完成',
               'status': status, 'environment': 'local', 'knowledge': '测试库', 'startedAt': now().isoformat(), 'duration': 40,
               'nodes': [
                   {'id': 'plan', 'name': '规划', 'type': 'llm', 'status': 'success', 'start': 0, 'duration': 10,
                    'input': {'messages': [{'role': 'user', 'content': '请查询远程办公制度'}], 'Authorization': 'Bearer secret'},
                    'output': {'public_plan': [{'step': '检索制度'}, {'step': '回答并引用'}]},
                    'inputTokens': 100, 'outputTokens': 30, 'cost': None, 'tokenSource': 'provider',
                    'context': [{'role': 'user', 'content': '请查询远程办公制度', 'tokens': 10}], 'events': ['model.response']},
                   {'id': 'tool', 'parent': 'plan', 'name': 'search', 'type': 'tool', 'status': status, 'start': 10, 'duration': 30,
                    'input': {'query': '远程办公'}, 'output': {'evidence': '完整制度证据'}, 'events': ['tool.completed'],
                    **({'error': 'TOOL_TIMEOUT'} if status == 'failed' else {})},
               ], **({'issue': 'TOOL_TIMEOUT', 'issueNode': 'tool'} if status == 'failed' else {})}
    response = client.post('/api/observability/runs', json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def draft(run, dataset):
    return {'sourceRunId': run['id'], 'sourceTraceId': run['traceId'], 'datasetIds': [dataset],
            'label': 'badcase', 'reason': '工具需要改进', 'expectedAnswer': '正确引用', 'tags': ['工具', '工具']}


def test_capture_annotation_concurrency_and_independent_evidence():
    run, d1, d2 = report_agent('failed'), create_dataset(), create_dataset()
    body = draft(run, d1)
    # Concurrent requests must create one case, and the saved evidence is server-authoritative.
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(lambda _: client.post('/api/evaluations/cases', json=body), range(5)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    cases = [r.json() for r in results]
    assert len({r['item']['id'] for r in cases}) == 1
    assert sum(not r['duplicate'] for r in cases) == 1
    item = cases[0]['item']
    snapshot = copy.deepcopy(item['snapshot'])
    assert snapshot['nodes'][0]['input']['Authorization'] == '***'
    assert snapshot['nodes'][0]['cost'] is None
    assert snapshot['nodes'][1]['error'] == 'TOOL_TIMEOUT'
    assert snapshot['dataSource'] == 'reported'
    assert snapshot['input'] == '\n  请查询远程办公制度\n'
    duplicate = client.post('/api/evaluations/cases', json={**body, 'datasetIds': [d2], 'label': 'goodcase', 'reason': '不能覆盖'})
    assert duplicate.status_code == 200
    latest = duplicate.json()['item']
    assert latest['label'] == 'badcase' and latest['reason'] == body['reason']
    assert set(latest['datasetIds']) == {d1, d2}
    assert latest['snapshot'] == snapshot
    patch = {k: latest[k] for k in ('label', 'reason', 'expectedAnswer', 'tags', 'datasetIds')}
    patch.update(reason='人工修正原因', expectedRevision=latest['revision'])
    updated = client.patch(f"/api/evaluations/cases/{item['id']}", json=patch)
    assert updated.status_code == 200, updated.text
    assert updated.json()['snapshot'] == snapshot
    assert client.patch(f"/api/evaluations/cases/{item['id']}", json=patch).status_code == 409
    # Snapshot mutation attempts are rejected at both API and database boundaries.
    assert client.patch(f"/api/evaluations/cases/{item['id']}", json={**patch, 'snapshot': {}}).status_code == 422
    with SessionLocal() as session:
        with pytest.raises(DBAPIError):
            session.execute(text("UPDATE evaluation_cases SET snapshot = '{}'::jsonb WHERE id = :id"), {'id': item['id']})
        session.rollback()
        session.execute(delete(ObservedRun).where(ObservedRun.id == run['id']))
        session.commit()
    # A separate client has no localStorage, but sees the same immutable case after source deletion.
    state = TestClient(app).get('/api/evaluations/state').json()
    saved = next(c for c in state['cases'] if c['id'] == item['id'])
    assert saved['reason'] == '人工修正原因' and saved['snapshot'] == snapshot
    assert client.get(f"/api/observability/runs/{run['id']}").status_code == 404


def test_validation_and_atomic_bulk_collection():
    dataset, other = create_dataset(), create_dataset()
    run = report_agent()
    body = draft(run, dataset)
    assert client.post('/api/evaluations/datasets', json={'name': '   '}).status_code == 422
    with SessionLocal() as session:
        name = session.get(EvaluationDataset, uuid.UUID(dataset)).name
    assert client.post('/api/evaluations/datasets', json={'name': name}).status_code == 409
    assert client.post('/api/evaluations/cases', json={**body, 'datasetIds': [str(uuid.uuid4())]}).status_code == 422
    assert client.post('/api/evaluations/cases', json={**body, 'sourceTraceId': 'wrong'}).status_code == 404
    item = client.post('/api/evaluations/cases', json=body).json()['item']
    bulk = client.post('/api/evaluations/cases/bulk-collect', json={'caseIds': [item['id'], str(uuid.uuid4())], 'datasetId': other})
    assert bulk.status_code == 404
    state = client.get('/api/evaluations/state').json()
    assert next(c for c in state['cases'] if c['id'] == item['id'])['datasetIds'] == [dataset]
    assert client.post('/api/evaluations/cases/bulk-collect', json={'caseIds': [item['id']], 'datasetId': other}).status_code == 200
    malformed = {**run, 'id': f"agent-{uuid.uuid4().hex}", 'traceId': uuid.uuid4().hex}
    malformed['nodes'] = [{**run['nodes'][0], 'parent': 'tool'}, run['nodes'][1]]
    assert client.post('/api/observability/runs', json=malformed).status_code == 422
    assert client.post('/api/observability/runs', json={**run, 'output': '改写已结束运行'}).status_code == 409
    pending = report_agent('running')
    assert client.post('/api/evaluations/cases', json=draft(pending, dataset)).status_code == 409
    # Runtime updates may end a running node while preserving already completed evidence.
    finished = copy.deepcopy(pending)
    finished.update(status='success', duration=60)
    finished['nodes'][1].update(status='success', duration=50)
    assert client.post('/api/observability/runs', json=finished).status_code == 200


def parse_done(raw):
    block = next(b for b in raw.split('\n\n') if b.startswith('event: done'))
    return json.loads(block.split('data: ', 1)[1])


def test_ingest_chat_trace_then_case_with_actual_model_callback(monkeypatch):
    from app.config import get_settings
    from app.rag import pipeline
    dataset = create_dataset()
    kb = client.post('/api/knowledge-bases', json={'name': '链路验收', 'owner': '测试'}).json()['id']
    content = '# 办公制度\n远程办公申请必须提前一个工作日提交直属主管审批。'
    uploaded = client.post(f'/api/knowledge-bases/{kb}/documents', files={'file': ('办公制度.md', io.BytesIO(content.encode()), 'text/markdown')})
    assert uploaded.status_code == 200 and uploaded.json()['document']['status'] == 'ready', uploaded.text
    traces = client.get('/api/observability/runs').json()['items']
    build = next(r for r in traces if r['input'] == '办公制度.md' and r['kind'] == 'build')
    assert build['status'] == 'success'
    assert any(n['output'].get('text') == content for n in build['nodes'] if isinstance(n['output'], dict))
    settings = get_settings()
    monkeypatch.setattr(settings, 'llm_api_key', 'test-secret-only')
    monkeypatch.setattr(settings, 'llm_base_url', 'http://unreachable.test/v1')
    fake = FakeMessagesListChatModel(responses=[AIMessage(content='提前一个工作日提交直属主管审批。[1]', usage_metadata={'input_tokens': 123, 'output_tokens': 21, 'total_tokens': 144})])
    monkeypatch.setattr(pipeline, 'build_answer_chain', lambda settings, documents: ChatPromptTemplate.from_messages([('system', '只根据制度回答'), ('human', '{question}')]) | fake | StrOutputParser())
    raw = client.post('/api/chat/completions', json={'message': '远程办公申请如何提交', 'knowledgeBaseIds': [kb]}).text
    assert 'event: done' in raw, raw
    meta = parse_done(raw)
    trace = client.get(f"/api/observability/runs/{meta['runId']}").json()
    assert trace['status'] == 'success' and trace['dataSource'] == 'captured'
    llm = next(n for n in trace['nodes'] if n['type'] == 'llm')
    assert llm['inputTokens'] == 123 and llm['outputTokens'] == 21 and llm['cost'] is None
    assert llm['context'][1]['content'] == '远程办公申请如何提交'
    assert llm['executionSource']['code'] and llm['executionSource']['annotations']
    item = client.post('/api/evaluations/cases', json=draft(trace, dataset)).json()['item']
    assert item['snapshot'] == trace
    # A provider error must end the run and remain capturable as a badcase.
    import app.api.chat as chat_module
    def failure(*args, **kwargs):
        raise TimeoutError('test-secret-only provider timeout')
        yield ''
    monkeypatch.setattr(chat_module, 'stream_answer', failure)
    raw = client.post('/api/chat/completions', json={'message': '远程办公申请如何提交', 'knowledgeBaseIds': [kb]}).text
    assert 'event: error' in raw and 'test-secret-only' not in raw
    failed = next(r for r in client.get('/api/observability/runs').json()['items'] if r['kind'] == 'chat' and r['status'] == 'failed' and r['knowledge'] == '链路验收')
    assert client.post('/api/evaluations/cases', json=draft(failed, dataset)).status_code == 200
    # Broken file => actual failed build trace, no fabricated parsing result.
    failed_upload = client.post(f'/api/knowledge-bases/{kb}/documents', files={'file': ('broken.pdf', io.BytesIO(b'not-a-pdf'), 'application/pdf')})
    assert failed_upload.json()['document']['status'] == 'failed'
    builds = client.get('/api/observability/runs').json()['items']
    assert any(r['kind'] == 'build' and r['input'] == 'broken.pdf' and r['status'] == 'failed' for r in builds)
    client.delete(f'/api/knowledge-bases/{kb}')
