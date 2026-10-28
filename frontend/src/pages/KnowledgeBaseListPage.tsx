import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRemoteKnowledgeBase } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { usePrototype } from '../context/PrototypeContext';
import type { KnowledgeBase, KnowledgeStatus } from '../types';
import './knowledge-pages.css';

interface CreateKnowledgeValues {
  name: string;
  description?: string;
  owner: string;
  embeddingModel: string;
}

const statusOptions: Array<{ label: string; value: KnowledgeStatus | 'all' }> = [
  { label: '全部状态', value: 'all' },
  { label: '已就绪', value: 'ready' },
  { label: '处理中', value: 'processing' },
  { label: '需复核', value: 'warning' },
  { label: '已停用', value: 'disabled' },
];

export function KnowledgeBaseListPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { knowledgeBases, addKnowledgeBase, apiEnabled, apiLoading, apiError, reloadWorkspace } =
    usePrototype();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<KnowledgeStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm<CreateKnowledgeValues>();

  const filteredKnowledgeBases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return knowledgeBases.filter((knowledgeBase) => {
      const matchesStatus = status === 'all' || knowledgeBase.status === status;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        knowledgeBase.name.toLowerCase().includes(normalizedQuery) ||
        knowledgeBase.description.toLowerCase().includes(normalizedQuery) ||
        knowledgeBase.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [knowledgeBases, query, status]);

  const totalDocuments = knowledgeBases.reduce(
    (total, knowledgeBase) => total + knowledgeBase.documentCount,
    0,
  );
  const totalChunks = knowledgeBases.reduce(
    (total, knowledgeBase) => total + knowledgeBase.chunkCount,
    0,
  );

  const createKnowledgeBase = (values: CreateKnowledgeValues) => {
    if (apiEnabled) {
      void createRemoteKnowledgeBase({
        name: values.name,
        description: values.description,
        owner: values.owner,
        embeddingModel: values.embeddingModel,
      })
        .then(async (created) => {
          await reloadWorkspace();
          setIsModalOpen(false);
          form.resetFields();
          void message.success('知识库已写入后端，可以开始导入文件');
          navigate(`/knowledge/${created.id}`);
        })
        .catch((error: unknown) => {
          void message.error(error instanceof Error ? error.message : '创建失败');
        });
      return;
    }
    const id = `kb-${Date.now()}`;
    const knowledgeBase: KnowledgeBase = {
      id,
      name: values.name,
      description: values.description || '尚未添加知识库说明。',
      status: 'ready',
      documentCount: 0,
      chunkCount: 0,
      embeddingModel: values.embeddingModel,
      updatedAt: '刚刚',
      owner: values.owner,
      tags: ['新建', '未导入'],
    };
    addKnowledgeBase(knowledgeBase);
    setIsModalOpen(false);
    form.resetFields();
    void message.success('知识库已创建，可以开始导入文件');
    navigate(`/knowledge/${id}`);
  };

  return (
    <div className="app-page knowledge-list-page">
      <PageHeader
        eyebrow="Knowledge bases"
        title="知识库"
        description="集中管理企业文档、解析任务与索引状态。进入知识库后可预览分块，并在发布前完成检索测试。"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
            新建知识库
          </Button>
        }
      />

      {apiEnabled ? (
        <Alert
          style={{ marginBottom: 16 }}
          type={apiError ? 'error' : 'info'}
          showIcon
          message={apiError ? '后端暂时不可用' : '当前连接后端 API'}
          description={apiError ?? '知识库列表和导入向导读写数据库。在线对话仍使用页面内 Mock。'}
        />
      ) : null}
      {apiLoading && knowledgeBases.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      ) : null}

      <section className="knowledge-summary" aria-label="知识库统计">
        <div className="knowledge-summary__item">
          <span className="knowledge-summary__icon knowledge-summary__icon--purple">
            <DatabaseOutlined />
          </span>
          <div>
            <strong className="numeric">{knowledgeBases.length}</strong>
            <span>知识库</span>
          </div>
        </div>
        <div className="knowledge-summary__item">
          <span className="knowledge-summary__icon knowledge-summary__icon--blue">
            <FileTextOutlined />
          </span>
          <div>
            <strong className="numeric">{totalDocuments.toLocaleString()}</strong>
            <span>文件</span>
          </div>
        </div>
        <div className="knowledge-summary__item">
          <span className="knowledge-summary__icon knowledge-summary__icon--green">
            <AppstoreOutlined />
          </span>
          <div>
            <strong className="numeric">{totalChunks.toLocaleString()}</strong>
            <span>有效分块</span>
          </div>
        </div>
        <div className="knowledge-summary__note">
          <BookOutlined />
          <span>{apiEnabled ? '向量维度' : '默认索引模型'}</span>
          <strong>{apiEnabled ? '1024' : 'qwen3-embedding-0.6b · 1024d'}</strong>
        </div>
      </section>

      <div className="knowledge-toolbar">
        <Input
          allowClear
          value={query}
          prefix={<SearchOutlined />}
          placeholder="搜索知识库名称、说明或标签"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          value={status}
          options={statusOptions}
          onChange={setStatus}
          aria-label="筛选知识库状态"
        />
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          aria-label="切换知识库视图"
          options={[
            { value: 'card', label: <AppstoreOutlined /> },
            { value: 'table', label: <UnorderedListOutlined /> },
          ]}
        />
        <span className="knowledge-toolbar__count">
          共 <strong>{filteredKnowledgeBases.length}</strong> 个结果
        </span>
      </div>

      {apiLoading && knowledgeBases.length === 0 ? null : filteredKnowledgeBases.length === 0 ? (
        <Card className="surface-card knowledge-empty" bordered={false}>
          <Empty description="没有符合条件的知识库">
            <Button
              onClick={() => {
                setQuery('');
                setStatus('all');
              }}
            >
              清除筛选
            </Button>
          </Empty>
        </Card>
      ) : viewMode === 'table' ? (
        <Card className="surface-card" bordered={false}>
          <Table<KnowledgeBase>
            rowKey="id"
            pagination={false}
            dataSource={filteredKnowledgeBases}
            scroll={{ x: 860 }}
            onRow={(record) => ({
              onClick: () => navigate(`/knowledge/${record.id}`),
              style: { cursor: 'pointer' },
            })}
            columns={
              [
                { title: '知识库', dataIndex: 'name', render: (name: string) => <strong>{name}</strong> },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 110,
                  render: (value: KnowledgeStatus) => <StatusPill status={value} />,
                },
                {
                  title: '文件',
                  dataIndex: 'documentCount',
                  width: 90,
                  render: (value: number) => <span className="numeric">{value}</span>,
                },
                {
                  title: '分块',
                  dataIndex: 'chunkCount',
                  width: 110,
                  render: (value: number) => <span className="numeric">{value.toLocaleString()}</span>,
                },
                { title: 'Embedding', dataIndex: 'embeddingModel', ellipsis: true },
                { title: '更新时间', dataIndex: 'updatedAt', width: 130 },
              ] satisfies TableColumnsType<KnowledgeBase>
            }
          />
        </Card>
      ) : (
        <Row gutter={[18, 18]}>
          {filteredKnowledgeBases.map((knowledgeBase) => (
            <Col key={knowledgeBase.id} xs={24} xl={12} xxl={8}>
              <Card
                className="knowledge-card surface-card"
                bordered={false}
                hoverable
                onClick={() => navigate(`/knowledge/${knowledgeBase.id}`)}
              >
                <div className="knowledge-card__header">
                  <span className="knowledge-card__icon">
                    <DatabaseOutlined />
                  </span>
                  <div className="knowledge-card__title">
                    <strong>{knowledgeBase.name}</strong>
                    <StatusPill status={knowledgeBase.status} />
                  </div>
                </div>
                <p>{knowledgeBase.description}</p>
                <div className="knowledge-card__tags">
                  {knowledgeBase.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
                <div className="knowledge-card__metrics">
                  <span>
                    <FileTextOutlined />
                    <strong className="numeric">{knowledgeBase.documentCount}</strong> 文件
                  </span>
                  <span>
                    <AppstoreOutlined />
                    <strong className="numeric">
                      {knowledgeBase.chunkCount.toLocaleString()}
                    </strong>{' '}
                    分块
                  </span>
                  <span>
                    <TeamOutlined /> {knowledgeBase.owner}
                  </span>
                </div>
                <footer className="knowledge-card__footer">
                  <span>{knowledgeBase.embeddingModel}</span>
                  <span>更新于 {knowledgeBase.updatedAt}</span>
                </footer>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        open={isModalOpen}
        title="创建知识库"
        okText="创建并进入"
        cancelText="取消"
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        width={620}
      >
        <div className="knowledge-modal-intro">
          <DatabaseOutlined />
          <div>
            <strong>先建立索引空间，再导入企业资料</strong>
            <span>Embedding 配置在首次入库后将被锁定，切换模型需要重建索引。</span>
          </div>
        </div>
        <Form<CreateKnowledgeValues>
          form={form}
          layout="vertical"
          initialValues={{
            owner: '知识运营组',
            embeddingModel: 'qwen3-embedding-0.6b · 1024d',
          }}
          onFinish={createKnowledgeBase}
        >
          <Form.Item
            name="name"
            label="知识库名称"
            rules={[{ required: true, message: '请输入知识库名称' }]}
          >
            <Input placeholder="例如：售后服务知识库" maxLength={40} showCount />
          </Form.Item>
          <Form.Item name="description" label="知识库说明">
            <Input.TextArea
              placeholder="说明资料范围、使用对象和维护边界"
              rows={3}
              maxLength={160}
              showCount
            />
          </Form.Item>
          <Row gutter={14}>
            <Col span={10}>
              <Form.Item
                name="owner"
                label="负责人"
                rules={[{ required: true, message: '请输入负责人' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="embeddingModel" label="Embedding 配置">
                <Select
                  options={[
                    {
                      label: '默认索引模型 · qwen3-embedding-0.6b · 1024d',
                      value: 'qwen3-embedding-0.6b · 1024d',
                    },
                    {
                      label: 'OpenRouter · text-embedding-3-small · 1536d',
                      value: 'text-embedding-3-small · 1536d',
                    },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Space className="knowledge-modal-tip" size={8}>
          <span>提示</span>
          当前为原型，创建的数据仅保留在本次页面会话中。
        </Space>
      </Modal>
    </div>
  );
}
