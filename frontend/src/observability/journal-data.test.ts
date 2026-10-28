import { describe, expect, it } from 'vitest';
import { buildJournal } from './journal-data';
import { usageOf, type ObsRun } from './data';

function run(): ObsRun {
  return { id: 'agent-test', traceId: 'trace-test', kind: 'agent', name: '测试执行器', version: 'test', input: '问题',
    output: '', status: 'running', environment: 'local', knowledge: '测试库', startedAt: new Date().toISOString(), duration: 10, dataSource: 'reported',
    nodes: [{ id: 'llm', name: '模型规划', type: 'llm', status: 'running', start: 0, duration: 0,
      input: { messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'search', arguments: '{"query":"制度"}' } }] }], tools: [{ name: 'search' }] },
      output: null, context: [{ role: 'assistant', content: '公开摘要', tokens: 3 }], events: ['model.started'], cost: null }] };
}

describe('执行记录的数据完整性', () => {
  it('保留原始请求的工具调用字段，不用摘要上下文覆盖', () => {
    const source = run();
    const event = buildJournal(source).find(e => e.id === 'llm:start')!;
    expect((event.payload as { messages: unknown[] }).messages).toEqual((source.nodes[0].input as { messages: unknown[] }).messages);
    expect(JSON.stringify(event.payload)).toContain('call-1');
  });
  it('运行中节点不产生虚假的完成事件', () => {
    const events = buildJournal(run());
    expect(events.some(e => e.id === 'llm:end')).toBe(false);
    expect(events.find(e => e.id === 'task-output')?.label).toContain('尚无最终完成结果');
  });
  it('供应商已返回 Token、但单价未知时仍展示真实用量', () => {
    const source = run();
    source.nodes[0].inputTokens = 123;
    source.nodes[0].outputTokens = 45;
    const usage = usageOf(source);
    expect(usage.input + usage.output).toBe(168);
    expect(usage.tokenUnknown).toBe(0);
    expect(usage.unknown).toBe(1);
  });
});
