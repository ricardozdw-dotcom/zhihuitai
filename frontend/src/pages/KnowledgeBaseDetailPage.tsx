import {
  App,
  Alert,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  MessageOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DocumentMetadataView } from '../components/DocumentMetadataView';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { usePrototype } from '../context/PrototypeContext';
import { retrievalResults } from '../data/mock';
import type { KnowledgeChunk, KnowledgeDocument } from '../types';
import './knowledge-pages.css';
import './document-edit.css';

const documentStatus = {
  ready: <StatusPill status="ready" label="已完成" />,
  processing: <StatusPill status="processing" label="索引中" />,
  failed: <StatusPill status="error" label="解析失败" />,
};

interface DocumentEditDraft {
  id: string;
  name: string;
  metadata: KnowledgeDocument['metadata'];
}

export function KnowledgeBaseDetailPage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { id = '' } = useParams();
  const {
    knowledgeBases,
    documentsByKnowledgeBase,
    chunksByKnowledgeBase,
    updateDocument,
    retryDocument,
    removeDocument,
    updateChunk,
    setChunkEnabled,
    setAllChunksEnabled,
    setSelectedKnowledgeBaseIds,
    apiEnabled,
    apiLoading,
  } = usePrototype();
  const knowledgeBase = knowledgeBases.find((item) => item.id === id);
  const documents = documentsByKnowledgeBase[id] ?? [];
  const chunks = chunksByKnowledgeBase[id] ?? [];
  const [docQuery, setDocQuery] = useState('');
  const [docStatus, setDocStatus] = useState<'all' | KnowledgeDocument['status']>('all');
  const [chunkQuery, setChunkQuery] = useState('');
  const [chunkFilter, setChunkFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [testQuery, setTestQuery] = useState('通用版本部署需要多少服务器？');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [retrievalMode, setRetrievalMode] = useState('hybrid');
  const [rerankMode, setRerankMode] = useState('rerank');
  const [activeTab, setActiveTab] = useState('documents');
  const [editingChunk, setEditingChunk] = useState<KnowledgeChunk | null>(null);
  const [chunkDraft, setChunkDraft] = useState('');
  const [documentDraft, setDocumentDraft] = useState<DocumentEditDraft | null>(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

  useEffect(() => {
    const current = knowledgeBases.find((item) => item.id === id);
    if (!current) return;
    setHasSearched(current.chunkCount > 0 && current.status !== 'disabled');
    setIsSearching(false);
    setActiveTab('documents');
    setDocQuery('');
    setChunkQuery('');
    // 只在切换知识库时重置页签，避免重试或编辑把用户带回文件列表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const visibleDocuments = documents.filter((document) => {
    const matchesStatus = docStatus === 'all' || document.status === docStatus;
    const keyword = docQuery.trim().toLowerCase();
    const haystack = [
      document.name,
      document.metadata.subject,
      document.metadata.owner,
      document.metadata.version,
      ...document.metadata.keywords,
      ...document.metadata.questions,
    ]
      .join(' ')
      .toLowerCase();
    const matchesQuery = keyword.length === 0 || haystack.includes(keyword);
    return matchesStatus && matchesQuery;
  });

  const visibleChunks = chunks.filter((chunk) => {
    const matchesFilter =
      chunkFilter === 'all' ||
      (chunkFilter === 'enabled' ? chunk.enabled : !chunk.enabled);
    const keyword = chunkQuery.trim().toLowerCase();
    const matchesQuery =
      keyword.length === 0 ||
      chunk.title.toLowerCase().includes(keyword) ||
      chunk.content.toLowerCase().includes(keyword) ||
      chunk.source.toLowerCase().includes(keyword);
    return matchesFilter && matchesQuery;
  });

  const readyDocuments = documents.filter((document) => document.status === 'ready').length;
  const indexingProgress =
    documents.length === 0 ? 0 : Math.round((readyDocuments / documents.length) * 100);
  const enabledChunks = chunks.filter((chunk) => chunk.enabled).length;

  const rankedResults = useMemo(() => {
    return retrievalResults
      .map((result) => {
        const rerankScore =
          rerankMode === 'none'
            ? Number(((result.denseScore + result.keywordScore) / 2).toFixed(3))
            : retrievalMode === 'dense'
              ? result.denseScore
              : retrievalMode === 'keyword'
                ? result.keywordScore
                : result.rerankScore;
        return { ...result, rerankScore };
      })
      .sort((left, right) => right.rerankScore - left.rerankScore);
  }, [rerankMode, retrievalMode]);

  const documentColumns = useMemo<TableColumnsType<KnowledgeDocument>>(
    () => [
      {
        title: '文件',
        dataIndex: 'name',
        key: 'name',
        render: (name: string, record) => (
          <div className="document-name-cell">
            <span className={`file-format file-format--${record.format.toLowerCase()}`}>
              {record.format.slice(0, 3)}
            </span>
            <div>
              <strong>{name}</strong>
              <span className={record.errorReason ? 'document-name-cell__error' : undefined}>
                {record.errorReason ?? `${record.size} · ${record.parser}`}
              </span>
              {record.metadata.keywords.length > 0 ? (
                <span className="document-keyword-row">
                  {record.metadata.keywords.slice(0, 3).map((keyword) => (
                    <Tag key={keyword}>{keyword}</Tag>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (status: KnowledgeDocument['status']) => documentStatus[status],
      },
      {
        title: '分块',
        dataIndex: 'chunks',
        key: 'chunks',
        width: 90,
        render: (chunksCount: number) => (
          <span className="numeric table-number">{chunksCount || '—'}</span>
        ),
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 130,
      },
      {
        title: '',
        key: 'actions',
        width: 52,
        align: 'right',
        render: (_, record) => {
          const items: MenuProps['items'] = [
            { key: 'edit', label: '编辑文档信息与标注', icon: <EditOutlined /> },
            { key: 'view', label: '查看分块', icon: <FileTextOutlined /> },
            { key: 'metadata', label: '查看元数据', icon: <TagsOutlined /> },
            {
              key: 'retry',
              label: record.status === 'failed' ? '重新解析' : '重新索引',
              icon: <ReloadOutlined />,
              disabled: record.status === 'processing',
            },
            { type: 'divider' },
            { key: 'delete', label: '删除文件', danger: true, icon: <DeleteOutlined /> },
          ];
          return (
            <Dropdown
              menu={{
                items,
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (!knowledgeBase) return;
                  if (key === 'edit') {
                    setDocumentDraft({
                      id: record.id,
                      name: record.name,
                      metadata: {
                        ...record.metadata,
                        keywords: [...record.metadata.keywords],
                        questions: [...record.metadata.questions],
                      },
                    });
                    return;
                  }
                  if (key === 'delete') {
                    modal.confirm({
                      title: `删除「${record.name}」？`,
                      content: '文件会从本次原型会话中移除。',
                      okText: '删除',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                      onOk: () => {
                        removeDocument(knowledgeBase.id, record.id);
                        void message.success('文件已删除');
                      },
                    });
                    return;
                  }
                  if (key === 'view') {
                    setActiveTab('chunks');
                    return;
                  }
                  if (key === 'metadata') {
                    setExpandedRowKeys((current) =>
                      current.includes(record.id)
                        ? current.filter((item) => item !== record.id)
                        : [...current, record.id],
                    );
                    return;
                  }
                  const accepted = retryDocument(knowledgeBase.id, record.id);
                  if (!accepted) {
                    void message.error('OCR 额度不足，请先在模型配置中补充额度后再重试');
                    return;
                  }
                  void message.success('已重新提交任务');
                },
              }}
              trigger={['click']}
            >
              <Button
                type="text"
                shape="circle"
                icon={<MoreOutlined />}
                aria-label={`${record.name} 的更多操作`}
                onClick={(event) => event.stopPropagation()}
              />
            </Dropdown>
          );
        },
      },
    ],
    [knowledgeBase, message, modal, removeDocument, retryDocument],
  );

  if (!knowledgeBase) {
    if (apiEnabled && apiLoading) {
      return (
        <div className="app-page" style={{ padding: '80px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      );
    }
    return (
      <div className="app-page">
        <Result
          status="404"
          title="未找到知识库"
          subTitle="它可能尚未创建，或只存在于另一次原型会话中。"
          extra={
            <Button type="primary" onClick={() => navigate('/knowledge')}>
              返回知识库列表
            </Button>
          }
        />
      </div>
    );
  }

  const openInChat = () => {
    if (knowledgeBase.status === 'disabled') {
      void message.warning('已停用的知识库不能用于在线对话');
      return;
    }
    setSelectedKnowledgeBaseIds([knowledgeBase.id]);
    navigate('/chat');
  };

  const runRetrievalTest = () => {
    if (knowledgeBase.status === 'disabled') {
      void message.warning('知识库已停用，请先启用后再测试');
      return;
    }
    if (knowledgeBase.chunkCount === 0 || enabledChunks === 0) {
      void message.warning('当前没有可检索的分块，请先导入文件或启用分块');
      return;
    }
    if (!testQuery.trim()) {
      void message.warning('请输入测试问题');
      return;
    }
    setIsSearching(true);
    setHasSearched(false);
    window.setTimeout(() => {
      setIsSearching(false);
      setHasSearched(true);
    }, 760);
  };

  const documentsTab = (
    <div className="detail-tab-body">
      <div className="detail-tab-toolbar">
        <Input
          allowClear
          value={docQuery}
          prefix={<SearchOutlined />}
          placeholder="搜索文件、关键词或主体"
          onChange={(event) => setDocQuery(event.target.value)}
        />
        <Select
          value={docStatus}
          onChange={setDocStatus}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'ready', label: '已完成' },
            { value: 'processing', label: '索引中' },
            { value: 'failed', label: '解析失败' },
          ]}
        />
        <span className="detail-tab-toolbar__spacer" />
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          onClick={() => navigate(`/knowledge/${knowledgeBase.id}/import`)}
        >
          导入知识
        </Button>
      </div>
      {documents.some((document) => document.errorReason?.includes('额度')) ? (
        <Alert
          style={{ marginBottom: 14 }}
          type="error"
          showIcon
          message="有文件因 OCR 额度不足未能解析"
          description="补充额度后，可在文件菜单中重新解析。"
        />
      ) : null}
      {documents.length === 0 ? (
        <Empty description="这个知识库还没有文件">
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => navigate(`/knowledge/${knowledgeBase.id}/import`)}
          >
            导入第一批文件
          </Button>
        </Empty>
      ) : visibleDocuments.length === 0 ? (
        <Empty description="没有符合条件的文件" />
      ) : (
        <>
          {knowledgeBase.documentCount > documents.length ? (
            <Alert
              style={{ marginBottom: 14 }}
              type="info"
              showIcon
              message={`当前展示最近 ${documents.length} 个文件，知识库共 ${knowledgeBase.documentCount} 个。`}
            />
          ) : null}
          <Table<KnowledgeDocument>
            rowKey="id"
            columns={documentColumns}
            dataSource={visibleDocuments}
            pagination={false}
            className="knowledge-table"
            scroll={{ x: 760 }}
            expandable={{
              expandedRowKeys,
              onExpandedRowsChange: (keys) => setExpandedRowKeys(keys.map(String)),
              expandedRowRender: (record) => <DocumentMetadataView metadata={record.metadata} />,
            }}
          />
        </>
      )}
    </div>
  );

  const chunksTab = (
    <div className="detail-tab-body">
      <div className="detail-tab-toolbar">
        <Input
          allowClear
          value={chunkQuery}
          prefix={<SearchOutlined />}
          placeholder="搜索分块内容或来源"
          onChange={(event) => setChunkQuery(event.target.value)}
        />
        <Select
          value={chunkFilter}
          onChange={setChunkFilter}
          options={[
            { value: 'all', label: '全部分块' },
            { value: 'enabled', label: '仅已启用' },
            { value: 'disabled', label: '仅已停用' },
          ]}
        />
        <span className="detail-tab-toolbar__spacer" />
        <Dropdown
          menu={{
            items: [
              { key: 'on', label: '全部启用' },
              { key: 'off', label: '全部停用' },
            ],
            onClick: ({ key }) => {
              setAllChunksEnabled(knowledgeBase.id, key === 'on');
              void message.success(key === 'on' ? '已启用全部分块' : '已停用全部分块');
            },
          }}
        >
          <Button>批量调整</Button>
        </Dropdown>
      </div>
      {chunks.length === 0 ? (
        <Empty description="导入完成前还没有可预览的分块" />
      ) : visibleChunks.length === 0 ? (
        <Empty description="没有符合条件的分块" />
      ) : (
        <div className="chunk-list">
          {visibleChunks.map((chunk) => (
            <article key={chunk.id} className={`chunk-card${chunk.enabled ? '' : ' is-disabled'}`}>
              <header>
                <div>
                  <strong>{chunk.title}</strong>
                  <span>
                    {chunk.source} · {chunk.locator}
                  </span>
                </div>
                <Space size={8}>
                  <Tooltip title={chunk.enabled ? '停用分块' : '启用分块'}>
                    <Switch
                      size="small"
                      checked={chunk.enabled}
                      onChange={(checked) => setChunkEnabled(knowledgeBase.id, chunk.id, checked)}
                    />
                  </Tooltip>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditingChunk(chunk);
                      setChunkDraft(chunk.content);
                    }}
                  >
                    编辑
                  </Button>
                </Space>
              </header>
              <p>{chunk.content}</p>
              <footer>
                <span>ID: {chunk.id}</span>
                <span>{chunk.tokens} tokens</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  const retrievalTab = (
    <div className="retrieval-layout">
      <Card className="retrieval-query-card" bordered={false}>
        <div className="retrieval-query-card__title">
          <div>
            <span className="subtle-label">Search test</span>
            <h3>检索测试</h3>
            <p>发布前验证问题是否能命中正确原文，并检查重排前后的分数变化。</p>
          </div>
          <ThunderboltOutlined />
        </div>
        {knowledgeBase.status === 'disabled' ? (
          <Alert type="warning" showIcon message="知识库已停用，检索结果不会进入在线对话。" />
        ) : null}
        {knowledgeBase.chunkCount === 0 ? (
          <Alert
            type="info"
            showIcon
            message="模型与索引尚未就绪"
            description="这个知识库还没有分块。先完成导入，再回来验证召回。"
          />
        ) : null}
        <Input.TextArea
          value={testQuery}
          onChange={(event) => setTestQuery(event.target.value)}
          autoSize={{ minRows: 4, maxRows: 6 }}
          placeholder="输入一个真实业务问题"
        />
        <div className="retrieval-query-options">
          <Select
            value={retrievalMode}
            onChange={setRetrievalMode}
            options={[
              { value: 'hybrid', label: '混合检索 · Dense + 关键词' },
              { value: 'dense', label: '仅语义检索' },
              { value: 'keyword', label: '仅关键词检索' },
            ]}
          />
          <Select
            value={rerankMode}
            onChange={setRerankMode}
            options={[
              { value: 'rerank', label: '启用 qwen3-rerank' },
              { value: 'none', label: '不使用 Rerank' },
            ]}
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={isSearching}
            onClick={runRetrievalTest}
          >
            开始测试
          </Button>
        </div>
      </Card>

      <section className="retrieval-results">
        <header>
          <div>
            <h3>召回结果</h3>
            <span>
              {isSearching
                ? '正在召回…'
                : hasSearched
                  ? `找到 ${rankedResults.length} 个高相关分块 · 286 ms`
                  : '等待测试'}
            </span>
          </div>
          {hasSearched && !isSearching ? <StatusPill status="success" label="检索质量良好" /> : null}
        </header>
        {isSearching ? (
          <div style={{ padding: '28px 0 12px' }}>
            <Spin spinning description="正在混合召回并重排">
              <div style={{ minHeight: 140 }} />
            </Spin>
          </div>
        ) : hasSearched ? (
          <div className="retrieval-result-list">
            {rankedResults.map((result, index) => (
              <article key={result.id} className="retrieval-result">
                <span className="retrieval-result__rank">{index + 1}</span>
                <div className="retrieval-result__content">
                  <header>
                    <strong>{result.title}</strong>
                    <Tag color={index === 0 ? 'green' : 'blue'}>
                      {rerankMode === 'none' ? '融合' : 'Rerank'} {result.rerankScore.toFixed(3)}
                    </Tag>
                  </header>
                  <p>{result.content}</p>
                  <footer>
                    <span>
                      <FileTextOutlined /> {result.source} · {result.locator}
                    </span>
                    <span>语义 {result.denseScore.toFixed(3)}</span>
                    <span>关键词 {result.keywordScore.toFixed(2)}</span>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty description="运行一次测试后显示召回结果" />
        )}
      </section>
    </div>
  );

  const settingsTab = (
    <div className="detail-settings">
      <Form
        layout="vertical"
        initialValues={{
          chunkSize: 800,
          overlap: 120,
          topK: 30,
          finalK: 6,
          threshold: 0.45,
          rewrite: true,
          rerank: true,
        }}
        onFinish={() => void message.success('知识库参数已保存（原型模拟）')}
      >
        <Card className="settings-section" bordered={false} title="分块与索引">
          <div className="settings-grid">
            <Form.Item name="chunkSize" label="目标分块长度">
              <InputNumber min={200} max={2000} addonAfter="字符" />
            </Form.Item>
            <Form.Item name="overlap" label="分块重叠">
              <InputNumber min={0} max={400} addonAfter="字符" />
            </Form.Item>
            <Form.Item label="Embedding 配置">
              <Select
                disabled
                value={knowledgeBase.embeddingModel}
                options={[
                  {
                    value: knowledgeBase.embeddingModel,
                    label: knowledgeBase.embeddingModel,
                  },
                ]}
              />
            </Form.Item>
          </div>
        </Card>
        <Card className="settings-section" bordered={false} title="在线检索">
          <div className="settings-grid">
            <Form.Item name="topK" label="初始召回数量">
              <InputNumber min={5} max={100} />
            </Form.Item>
            <Form.Item name="finalK" label="最终引用数量">
              <InputNumber min={1} max={20} />
            </Form.Item>
            <Form.Item name="threshold" label="最低相关度">
              <InputNumber min={0} max={1} step={0.05} />
            </Form.Item>
            <Form.Item name="rewrite" label="多轮问题补全" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="rerank" label="启用 Rerank" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Card>
        <Button type="primary" htmlType="submit">
          保存参数
        </Button>
      </Form>
    </div>
  );

  return (
    <div className="app-page knowledge-detail-page">
      <button className="back-link" type="button" onClick={() => navigate('/knowledge')}>
        <ArrowLeftOutlined /> 返回知识库
      </button>
      <PageHeader
        eyebrow="Knowledge base detail"
        title={knowledgeBase.name}
        description={knowledgeBase.description}
        actions={
          <Space>
            <Button icon={<MessageOutlined />} onClick={openInChat}>
              在对话中打开
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={() => navigate(`/knowledge/${knowledgeBase.id}/import`)}
            >
              导入知识
            </Button>
          </Space>
        }
      />

      <div className="knowledge-detail-layout">
        <Card className="knowledge-detail-main surface-card" bordered={false}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              { key: 'documents', label: `文件 ${documents.length}`, children: documentsTab },
              {
                key: 'chunks',
                label: `分块 ${knowledgeBase.chunkCount.toLocaleString()}`,
                children: chunksTab,
              },
              { key: 'retrieval', label: '检索测试', children: retrievalTab },
              { key: 'settings', label: '参数设置', children: settingsTab },
            ]}
          />
        </Card>

        <aside className="knowledge-inspector">
          <Card className="surface-card inspector-card" bordered={false}>
            <header>
              <span className="inspector-card__icon">
                <FileTextOutlined />
              </span>
              <div>
                <strong>知识库概览</strong>
                <StatusPill status={knowledgeBase.status} />
              </div>
            </header>
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="负责人">{knowledgeBase.owner}</Descriptions.Item>
              <Descriptions.Item label="文件">{knowledgeBase.documentCount} 个</Descriptions.Item>
              <Descriptions.Item label="分块">
                {knowledgeBase.chunkCount.toLocaleString()} 个
              </Descriptions.Item>
              <Descriptions.Item label="最近更新">{knowledgeBase.updatedAt}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Card className="surface-card inspector-card" bordered={false} title="索引配置">
            <div className="inspector-model">
              <span>Embedding</span>
              <strong>{knowledgeBase.embeddingModel}</strong>
            </div>
            <div className="inspector-model">
              <span>Rerank</span>
              <strong>qwen3-rerank</strong>
            </div>
            <div className="inspector-model">
              <span>OCR</span>
              <strong>阿里云文档结构化</strong>
            </div>
          </Card>
          <Card className="surface-card inspector-card" bordered={false} title="索引完成度">
            <Progress percent={indexingProgress} strokeColor="#5B67F1" />
            <p>
              {documents.length === 0
                ? '尚未导入文件。'
                : `${readyDocuments} 个展示文件已就绪，失败任务可以单独重试。`}
            </p>
            <div className="inspector-health">
              <CheckCircleFilled /> {enabledChunks} 个预览分块处于启用状态
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        title="编辑文档信息与标注"
        open={Boolean(documentDraft)}
        width={720}
        okText="保存标注"
        cancelText="取消"
        destroyOnHidden
        onCancel={() => setDocumentDraft(null)}
        onOk={() => {
          if (!documentDraft) return;
          if (!documentDraft.name.trim()) {
            void message.warning('文档名称不能为空');
            return;
          }
          updateDocument(knowledgeBase.id, documentDraft.id, {
            name: documentDraft.name.trim(),
            metadata: documentDraft.metadata,
            updatedAt: '刚刚',
          });
          setDocumentDraft(null);
          void message.success('文档信息与标注已更新');
        }}
      >
        {documentDraft ? (
          <div className="document-edit-form">
            <Alert
              type="info"
              showIcon
              message="文档导入完成后再补充业务标注；这些字段会用于后续筛选、检索与问答引用。"
            />
            <label className="document-edit-field document-edit-field--wide">
              <span>文档名称</span>
              <Input
                value={documentDraft.name}
                onChange={(event) =>
                  setDocumentDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </label>
            <label className="document-edit-field">
              <span>文档时间</span>
              <Input
                value={documentDraft.metadata.time}
                placeholder="例如 2026-10-28"
                onChange={(event) =>
                  setDocumentDraft((current) =>
                    current
                      ? {
                          ...current,
                          metadata: { ...current.metadata, time: event.target.value },
                        }
                      : current,
                  )
                }
              />
            </label>
            <label className="document-edit-field">
              <span>版本</span>
              <Input
                value={documentDraft.metadata.version}
                placeholder="例如 V1.0"
                onChange={(event) =>
                  setDocumentDraft((current) =>
                    current
                      ? {
                          ...current,
                          metadata: { ...current.metadata, version: event.target.value },
                        }
                      : current,
                  )
                }
              />
            </label>
            <label className="document-edit-field">
              <span>主体信息</span>
              <Input
                value={documentDraft.metadata.subject}
                placeholder="产品、部门或文档主题"
                onChange={(event) =>
                  setDocumentDraft((current) =>
                    current
                      ? {
                          ...current,
                          metadata: { ...current.metadata, subject: event.target.value },
                        }
                      : current,
                  )
                }
              />
            </label>
            <label className="document-edit-field">
              <span>负责人</span>
              <Input
                value={documentDraft.metadata.owner}
                onChange={(event) =>
                  setDocumentDraft((current) =>
                    current
                      ? {
                          ...current,
                          metadata: { ...current.metadata, owner: event.target.value },
                        }
                      : current,
                  )
                }
              />
            </label>
            <label className="document-edit-field document-edit-field--wide">
              <span>检索关键词</span>
              <Select
                mode="tags"
                value={documentDraft.metadata.keywords}
                tokenSeparators={[',', '，']}
                placeholder="输入关键词后回车添加"
                onChange={(keywords) =>
                  setDocumentDraft((current) =>
                    current
                      ? { ...current, metadata: { ...current.metadata, keywords } }
                      : current,
                  )
                }
              />
            </label>
            <label className="document-edit-field document-edit-field--wide">
              <span>可能被问到的问题</span>
              <Select
                mode="tags"
                value={documentDraft.metadata.questions}
                placeholder="输入问题后回车添加"
                onChange={(questions) =>
                  setDocumentDraft((current) =>
                    current
                      ? { ...current, metadata: { ...current.metadata, questions } }
                      : current,
                  )
                }
              />
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        title={editingChunk ? `编辑分块 · ${editingChunk.title}` : '编辑分块'}
        open={Boolean(editingChunk)}
        okText="保存"
        cancelText="取消"
        onCancel={() => setEditingChunk(null)}
        onOk={() => {
          if (!editingChunk) return;
          if (!chunkDraft.trim()) {
            void message.warning('分块内容不能为空');
            return;
          }
          updateChunk(knowledgeBase.id, editingChunk.id, { content: chunkDraft.trim() });
          setEditingChunk(null);
          void message.success('分块已更新');
        }}
      >
        <Input.TextArea
          value={chunkDraft}
          rows={6}
          maxLength={800}
          showCount
          onChange={(event) => setChunkDraft(event.target.value)}
        />
      </Modal>
    </div>
  );
}
