import {
  AlertOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { usePrototype } from '../context/PrototypeContext';
import { modelCalls as seedModelCalls } from '../data/mock';
import type { ImportTask, ModelCall, QueryLog } from '../types';
import './settings-logs.css';

type LogStatus = QueryLog['status'] | 'all';

function buildTrace(log: QueryLog) {
  const failed = log.status === 'error';
  const empty = log.status === 'empty';
  return [
    {
      color: 'green',
      title: '接收问题',
      time: '12 ms',
      detail: log.query,
    },
    {
      color: 'blue',
      title: '混合召回',
      time: `${log.retrievalMs} ms`,
      detail: `在「${log.knowledgeBase}」执行语义 + 关键词召回，并用 RRF 合并候选。`,
    },
    {
      color: log.rerankMs > 0 ? 'blue' : 'gray',
      title: 'Rerank',
      time: log.rerankMs > 0 ? `${log.rerankMs} ms` : '未调用',
      detail:
        log.rerankMs > 0
          ? 'qwen3-rerank 对候选分块重新评分，并按阈值过滤。'
          : failed
            ? '上游在重排前失败，本阶段未执行。'
            : '本次请求未启用 Rerank。',
    },
    {
      color: failed ? 'red' : 'green',
      title: 'LLM 生成',
      time: failed ? `${log.durationMs} ms` : `首 Token ${log.firstTokenMs} ms`,
      detail: failed
        ? `${log.provider} / ${log.model} 调用超时，未返回正文。`
        : `${log.provider} / ${log.model} 已生成回答。`,
    },
    {
      color: failed ? 'red' : empty ? 'orange' : 'green',
      title: '引用组装',
      time: failed ? '未完成' : '18 ms',
      detail: failed
        ? '请求中断，没有可展示的原文引用。'
        : empty
          ? '召回分数低于阈值，已按策略拒答，未附带引用。'
          : '已附带可定位的原文引用。',
    },
  ];
}

export function LogsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { queryLogs, importTasks, retryImportTask, ocrQuotaPages } = usePrototype();
  const [tab, setTab] = useState('chat');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<LogStatus>('all');
  const [taskStatus, setTaskStatus] = useState<'all' | ImportTask['status']>('all');
  const [capability, setCapability] = useState<'all' | ModelCall['capability']>('all');
  const [selectedLog, setSelectedLog] = useState<QueryLog | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filteredLogs = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return queryLogs.filter((log) => {
      const matchesStatus = status === 'all' || log.status === status;
      const matchesKeyword =
        normalized.length === 0 ||
        log.query.toLowerCase().includes(normalized) ||
        log.traceId.toLowerCase().includes(normalized) ||
        log.knowledgeBase.toLowerCase().includes(normalized);
      return matchesStatus && matchesKeyword;
    });
  }, [keyword, queryLogs, status]);

  const modelCallRows = useMemo<ModelCall[]>(() => {
    const fromQueries: ModelCall[] = queryLogs.map((log) => ({
      id: `call-${log.id}`,
      traceId: log.traceId,
      capability: 'LLM',
      provider: log.provider,
      model: log.model,
      status: log.status === 'error' ? 'error' : 'success',
      tokens: log.inputTokens + log.outputTokens,
      durationMs: Math.max(log.durationMs - log.retrievalMs - log.rerankMs, 0),
      createdAt: log.createdAt,
      detail: log.status === 'empty' ? '无足够依据，已拒答' : log.query,
    }));
    return [...fromQueries, ...seedModelCalls];
  }, [queryLogs]);

  const filteredCalls = modelCallRows.filter((call) => {
    const normalized = keyword.trim().toLowerCase();
    const matchesCapability = capability === 'all' || call.capability === capability;
    const matchesKeyword =
      normalized.length === 0 ||
      call.model.toLowerCase().includes(normalized) ||
      call.traceId.toLowerCase().includes(normalized) ||
      call.detail.toLowerCase().includes(normalized);
    return matchesCapability && matchesKeyword;
  });

  const filteredTasks = importTasks.filter((task) => {
    const normalized = keyword.trim().toLowerCase();
    const matchesStatus = taskStatus === 'all' || task.status === taskStatus;
    const matchesKeyword =
      normalized.length === 0 ||
      task.fileName.toLowerCase().includes(normalized) ||
      task.knowledgeBase.toLowerCase().includes(normalized);
    return matchesStatus && matchesKeyword;
  });

  const totalTokens = queryLogs.reduce(
    (sum, log) => sum + log.inputTokens + log.outputTokens,
    0,
  );
  const successLogs = queryLogs.filter((log) => log.status === 'success');
  const averageDuration = successLogs.length
    ? Math.round(successLogs.reduce((sum, log) => sum + log.durationMs, 0) / successLogs.length)
    : 0;
  const failedCalls = modelCallRows.filter((call) => call.status === 'error').length;

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => {
      setRefreshing(false);
      void message.success('日志已刷新');
    }, 500);
  };

  const retryTask = (task: ImportTask) => {
    const ok = retryImportTask(task.id);
    if (!ok) {
      void message.error('OCR 额度不足，请先在模型配置中补充额度后再重试');
      return;
    }
    void message.success('已重新提交导入任务');
  };

  const logColumns: TableColumnsType<QueryLog> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 168,
      render: (value: string) => <span className="numeric">{value.slice(5)}</span>,
    },
    {
      title: '问题',
      dataIndex: 'query',
      ellipsis: true,
      render: (value: string, record) => (
        <button type="button" className="log-query-button" onClick={() => setSelectedLog(record)}>
          <strong>{value}</strong>
          <small>{record.traceId}</small>
        </button>
      ),
    },
    { title: '知识库', dataIndex: 'knowledgeBase', width: 180, ellipsis: true },
    {
      title: '模型',
      dataIndex: 'model',
      width: 150,
      render: (value: string, record) => (
        <span>
          {value}
          <small className="log-subtext">{record.provider}</small>
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: QueryLog['status']) => <StatusPill status={value} />,
    },
    {
      title: 'Token',
      width: 110,
      render: (_, record) => (
        <span className="numeric">{(record.inputTokens + record.outputTokens).toLocaleString()}</span>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (value: number) => <span className="numeric">{(value / 1000).toFixed(2)}s</span>,
    },
  ];

  const callColumns: TableColumnsType<ModelCall> = [
    { title: '时间', dataIndex: 'createdAt', width: 168, render: (value: string) => value.slice(5) },
    { title: '能力', dataIndex: 'capability', width: 110 },
    { title: '供应商 / 模型', width: 220, render: (_, record) => `${record.provider} · ${record.model}` },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: ModelCall['status']) => (
        <StatusPill status={value === 'success' ? 'success' : 'error'} />
      ),
    },
    {
      title: 'Token',
      dataIndex: 'tokens',
      width: 100,
      render: (value: number) => <span className="numeric">{value.toLocaleString()}</span>,
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (value: number) => <span className="numeric">{value} ms</span>,
    },
    { title: '说明', dataIndex: 'detail', ellipsis: true },
    {
      title: '链路',
      width: 90,
      render: (_, record) => {
        const log = queryLogs.find((item) => item.traceId === record.traceId);
        return log ? (
          <Button type="link" size="small" onClick={() => setSelectedLog(log)}>
            查看
          </Button>
        ) : (
          <span className="log-subtext">{record.traceId}</span>
        );
      },
    },
  ];

  const taskColumns: TableColumnsType<ImportTask> = [
    { title: '文件', dataIndex: 'fileName', ellipsis: true },
    { title: '知识库', dataIndex: 'knowledgeBase', width: 180, ellipsis: true },
    { title: '阶段', dataIndex: 'stage', width: 110 },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 160,
      render: (value: number, record) => (
        <Progress
          percent={value}
          size="small"
          status={record.status === 'failed' ? 'exception' : record.status === 'success' ? 'success' : 'active'}
        />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: ImportTask['status']) => (
        <StatusPill
          status={value === 'success' ? 'success' : value === 'failed' ? 'error' : 'processing'}
          label={value === 'success' ? '已完成' : value === 'failed' ? '失败' : '处理中'}
        />
      ),
    },
    {
      title: '说明',
      dataIndex: 'error',
      ellipsis: true,
      render: (value: string | undefined, record) => value || (record.status === 'processing' ? '任务进行中' : '—'),
    },
    { title: '更新', dataIndex: 'updatedAt', width: 120 },
    {
      title: '',
      width: 90,
      render: (_, record) =>
        record.status === 'failed' ? (
          <Button size="small" icon={<ReloadOutlined />} onClick={() => retryTask(record)}>
            重试
          </Button>
        ) : null,
    },
  ];

  const selectedTrace = selectedLog ? buildTrace(selectedLog) : [];
  const maxStage = selectedLog
    ? Math.max(selectedLog.retrievalMs, selectedLog.rerankMs, selectedLog.firstTokenMs, 1)
    : 1;

  return (
    <div className="app-page logs-page">
      <PageHeader
        eyebrow="Observability"
        title="日志中心"
        description="查看对话、模型调用、Token 与导入任务。点开一条对话日志，可以下钻到召回、重排和生成的完整链路。"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refresh}>
              刷新
            </Button>
            <Button type="primary" onClick={() => navigate('/settings/models')}>
              模型配置
            </Button>
          </Space>
        }
      />

      <section className="logs-metrics">
        <MetricCard icon={<FileSearchOutlined />} label="对话请求" value={String(queryLogs.length)} helper="含本次会话新增" tone="purple" />
        <MetricCard icon={<ThunderboltOutlined />} label="Token 合计" value={totalTokens.toLocaleString()} helper="输入 + 输出" tone="blue" />
        <MetricCard icon={<ClockCircleOutlined />} label="成功均耗时" value={`${(averageDuration / 1000).toFixed(2)}s`} helper="不含失败请求" tone="green" />
        <MetricCard icon={<AlertOutlined />} label="失败调用" value={String(failedCalls)} helper={`OCR 剩余 ${ocrQuotaPages} 页`} tone="orange" />
      </section>

      {ocrQuotaPages < 40 ? (
        <Alert
          className="logs-quota-alert"
          type="error"
          showIcon
          message="OCR 额度不足"
          description={`阿里云 OCR 本月剩余 ${ocrQuotaPages} 页。扫描件和图片导入会失败，补充额度后可重试对应任务。`}
          action={
            <Button size="small" onClick={() => navigate('/settings/models')}>
              前往 OCR 配置
            </Button>
          }
        />
      ) : null}

      <Card className="surface-card logs-card" bordered={false}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'chat', label: '对话日志' },
            { key: 'calls', label: '模型调用' },
            { key: 'usage', label: 'Token / 耗时' },
            { key: 'tasks', label: '导入任务' },
          ]}
        />
        <div className="logs-toolbar">
          <Input
            allowClear
            value={keyword}
            placeholder="搜索问题、Trace、文件或模型"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {tab === 'chat' ? (
            <Select<LogStatus>
              value={status}
              aria-label="筛选对话状态"
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'success', label: '成功' },
                { value: 'empty', label: '无匹配' },
                { value: 'error', label: '失败' },
              ]}
            />
          ) : null}
          {tab === 'calls' ? (
            <Select
              value={capability}
              aria-label="筛选模型能力"
              onChange={setCapability}
              options={[
                { value: 'all', label: '全部能力' },
                { value: 'LLM', label: 'LLM' },
                { value: 'Embedding', label: 'Embedding' },
                { value: 'Rerank', label: 'Rerank' },
                { value: 'OCR', label: 'OCR' },
              ]}
            />
          ) : null}
          {tab === 'tasks' ? (
            <Select
              value={taskStatus}
              aria-label="筛选导入状态"
              onChange={setTaskStatus}
              options={[
                { value: 'all', label: '全部任务' },
                { value: 'processing', label: '处理中' },
                { value: 'failed', label: '失败' },
                { value: 'success', label: '已完成' },
              ]}
            />
          ) : null}
          <span className="logs-toolbar__count">
            {tab === 'chat'
              ? `${filteredLogs.length} 条对话`
              : tab === 'calls'
                ? `${filteredCalls.length} 次调用`
                : tab === 'tasks'
                  ? `${filteredTasks.length} 个任务`
                  : `${queryLogs.length} 条样本`}
          </span>
        </div>

        {tab === 'chat' ? (
          filteredLogs.length > 0 ? (
            <Table
              rowKey="id"
              size="middle"
              loading={refreshing}
              columns={logColumns}
              dataSource={filteredLogs}
              pagination={false}
              scroll={{ x: 980 }}
              onRow={(record) => ({ onClick: () => setSelectedLog(record) })}
            />
          ) : (
            <Empty description="没有符合条件的对话日志">
              <Button
                onClick={() => {
                  setKeyword('');
                  setStatus('all');
                }}
              >
                清除筛选
              </Button>
            </Empty>
          )
        ) : null}

        {tab === 'calls' ? (
          filteredCalls.length > 0 ? (
            <Table
              rowKey="id"
              size="middle"
              loading={refreshing}
              columns={callColumns}
              dataSource={filteredCalls}
              pagination={false}
              scroll={{ x: 980 }}
            />
          ) : (
            <Empty description="没有符合条件的模型调用" />
          )
        ) : null}

        {tab === 'usage' ? (
          <div className="usage-breakdown">
            {queryLogs.length === 0 ? (
              <Empty description="还没有用量数据" />
            ) : (
              queryLogs.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  className="usage-row"
                  onClick={() => setSelectedLog(log)}
                >
                  <div className="usage-row__title">
                    <strong>{log.query}</strong>
                    <span>
                      {(log.inputTokens + log.outputTokens).toLocaleString()} tokens · {log.model}
                    </span>
                  </div>
                  <div className="usage-bars" aria-label={`${log.query} 分段耗时`}>
                    <span style={{ width: `${(log.retrievalMs / maxAcross(log)) * 100}%` }}>
                      召回 {log.retrievalMs}ms
                    </span>
                    <span style={{ width: `${(log.rerankMs / maxAcross(log)) * 100}%` }}>
                      重排 {log.rerankMs}ms
                    </span>
                    <span style={{ width: `${(Math.max(log.firstTokenMs, 8) / maxAcross(log)) * 100}%` }}>
                      首 Token {log.firstTokenMs}ms
                    </span>
                  </div>
                  <StatusPill status={log.status} />
                </button>
              ))
            )}
          </div>
        ) : null}

        {tab === 'tasks' ? (
          filteredTasks.length > 0 ? (
            <Table
              rowKey="id"
              size="middle"
              loading={refreshing}
              columns={taskColumns}
              dataSource={filteredTasks}
              pagination={false}
              scroll={{ x: 980 }}
            />
          ) : (
            <Empty description="没有符合条件的导入任务" />
          )
        ) : null}
      </Card>

      <Drawer
        title="请求链路"
        width={560}
        open={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
      >
        {selectedLog ? (
          <div className="trace-drawer">
            <div className="trace-drawer__hero">
              <span className="subtle-label">{selectedLog.traceId}</span>
              <h3>{selectedLog.query}</h3>
              <Space wrap>
                <Tag>{selectedLog.knowledgeBase}</Tag>
                <Tag color="blue">
                  {selectedLog.provider} · {selectedLog.model}
                </Tag>
                <StatusPill status={selectedLog.status} />
              </Space>
            </div>
            <Timeline
              items={selectedTrace.map((step) => ({
                color: step.color,
                content: (
                  <div className="trace-step">
                    <header>
                      <strong>{step.title}</strong>
                      <span>{step.time}</span>
                    </header>
                    <p>{step.detail}</p>
                  </div>
                ),
              }))}
            />
            <div className="trace-metrics">
              <div>
                <span>输入 Token</span>
                <strong className="numeric">{selectedLog.inputTokens.toLocaleString()}</strong>
              </div>
              <div>
                <span>输出 Token</span>
                <strong className="numeric">{selectedLog.outputTokens.toLocaleString()}</strong>
              </div>
              <div>
                <span>总耗时</span>
                <strong className="numeric">{selectedLog.durationMs} ms</strong>
              </div>
            </div>
            <div className="trace-stage-list">
              {[
                ['召回', selectedLog.retrievalMs],
                ['Rerank', selectedLog.rerankMs],
                ['首 Token', selectedLog.firstTokenMs],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <Progress
                    percent={Math.round((Number(value) / maxStage) * 100)}
                    showInfo={false}
                    strokeColor="#5B67F1"
                    size="small"
                  />
                  <b className="numeric">{value} ms</b>
                </div>
              ))}
            </div>
            {selectedLog.status === 'error' ? (
              <Alert
                type="error"
                showIcon
                message="本次生成失败"
                description="检索阶段已完成，模型供应商超时后没有返回 Token。可以在对话页重新提问。"
              />
            ) : null}
            {selectedLog.status === 'empty' ? (
              <Alert
                type="warning"
                showIcon
                icon={<CheckCircleFilled />}
                message="无足够依据，已拒答"
                description="系统没有把低相关分块送入回答，避免编造制度或事实。"
              />
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function maxAcross(log: QueryLog) {
  return Math.max(log.retrievalMs, log.rerankMs, log.firstTokenMs, 1);
}
