import {
  AlertOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  DatabaseOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FireOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { App, Button, Card, Progress, Space, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { usePrototype } from '../context/PrototypeContext';
import { recentActivities } from '../data/mock';
import './dashboard-page.css';

const dailyUsage = [48, 62, 58, 76, 71, 88, 79, 96, 84, 108, 101, 124];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { role, knowledgeBases, providerProfiles } = usePrototype();
  const [refreshing, setRefreshing] = useState(false);
  const readyCount = knowledgeBases.filter((item) => item.status === 'ready').length;
  const healthyProfiles = providerProfiles.filter((item) => item.status === 'healthy').length;
  const pendingProfiles = providerProfiles.length - healthyProfiles;
  const healthPercent = providerProfiles.length
    ? Math.round((healthyProfiles / providerProfiles.length) * 100)
    : 0;
  const totalDocuments = knowledgeBases.reduce((sum, item) => sum + item.documentCount, 0);
  const totalChunks = knowledgeBases.reduce((sum, item) => sum + item.chunkCount, 0);

  return (
    <div className="app-page dashboard-page">
      <PageHeader
        eyebrow="Workspace overview"
        title={role === 'admin' ? '早上好，管理员' : '早上好，知识库管理人员'}
        description="掌握知识构建、问答质量与模型服务状态。所有指标均为原型 Mock 数据。"
        actions={
          <Space>
            <Button icon={<MessageOutlined />} onClick={() => navigate('/chat')}>
              开始对话
            </Button>
            <Button
              type="primary"
              icon={<FileAddOutlined />}
              onClick={() => navigate('/knowledge/kb-product/import')}
            >
              导入知识
            </Button>
          </Space>
        }
      />

      <section className="dashboard-metrics" aria-label="核心指标">
        <MetricCard
          icon={<DatabaseOutlined />}
          label="可用知识库"
          value={`${readyCount} / ${knowledgeBases.length}`}
          trend="+1 本月"
          helper="2 个待处理"
          tone="purple"
        />
        <MetricCard
          icon={<FileTextOutlined />}
          label="知识文件"
          value={totalDocuments.toLocaleString('zh-CN')}
          trend="+36 本周"
          helper="解析成功率 98.6%"
          tone="blue"
        />
        <MetricCard
          icon={<NodeIndexOutlined />}
          label="有效分块"
          value={totalChunks.toLocaleString('zh-CN')}
          trend="+8.4%"
          helper="平均 119 tokens"
          tone="green"
        />
        <MetricCard
          icon={<ThunderboltOutlined />}
          label="今日问答"
          value="1,284"
          trend="+12.8%"
          helper="平均耗时 1.86s"
          tone="orange"
        />
      </section>

      <section className="dashboard-main-grid">
        <Card className="usage-card surface-card" bordered={false}>
          <div className="card-section-heading">
            <div>
              <span className="subtle-label">Query volume</span>
              <h2>近 12 小时问答趋势</h2>
            </div>
            <div className="usage-card__summary">
              <strong className="numeric">8,620</strong>
              <span>近 7 天总问答</span>
            </div>
          </div>
          <div className="usage-chart" aria-label="近 12 小时问答量柱状图">
            {dailyUsage.map((value, index) => (
              <div key={`${value}-${index}`} className="usage-chart__column">
                <span className="usage-chart__value">{value}</span>
                <div style={{ height: `${(value / 124) * 100}%` }} />
                <small>{index % 2 === 0 ? `${index + 8}:00` : ''}</small>
              </div>
            ))}
          </div>
          <div className="usage-card__legend">
            <span><i className="legend-dot legend-dot--primary" />成功回答 94.2%</span>
            <span><i className="legend-dot legend-dot--warning" />无证据拒答 4.6%</span>
            <span><i className="legend-dot legend-dot--danger" />调用失败 1.2%</span>
          </div>
        </Card>

        <Card className="health-card surface-card" bordered={false}>
          <div className="card-section-heading">
            <div>
              <span className="subtle-label">Service health</span>
              <h2>模型与 OCR 状态</h2>
            </div>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              loading={refreshing}
              onClick={() => {
                setRefreshing(true);
                window.setTimeout(() => {
                  setRefreshing(false);
                  void message.success('已刷新模型与 OCR 状态');
                }, 500);
              }}
            >
              刷新
            </Button>
          </div>
          <div className="health-card__score">
            <Progress
              type="dashboard"
              percent={healthPercent}
              size={98}
              strokeColor={healthPercent >= 80 ? '#20A779' : '#E7A13D'}
              railColor="#EEF1F5"
              format={(percent) => <strong>{percent}%</strong>}
            />
            <div>
              <strong>{pendingProfiles === 0 ? '整体运行正常' : '部分配置待处理'}</strong>
              <span>
                {healthyProfiles} 个配置可用
                {pendingProfiles > 0 ? `，${pendingProfiles} 个待测试或异常` : ''}
              </span>
            </div>
          </div>
          <div className="health-list">
            {providerProfiles.slice(0, 4).map((profile) => (
              <div key={profile.id} className="health-list__row">
                <span className="health-list__icon">
                  {profile.capability === 'OCR' ? <FileTextOutlined /> : <CloudServerOutlined />}
                </span>
                <div>
                  <strong>{profile.capability} · {profile.provider}</strong>
                  <small>{profile.model}</small>
                </div>
                <span className="health-list__latency numeric">
                  {profile.latencyMs ? `${profile.latencyMs} ms` : '待测试'}
                </span>
                <StatusPill status={profile.status} />
              </div>
            ))}
          </div>
          {role === 'admin' ? (
            <Button block onClick={() => navigate('/settings/models')}>管理模型配置</Button>
          ) : null}
        </Card>
      </section>

      <section className="dashboard-lower-grid">
        <Card className="knowledge-overview-card surface-card" bordered={false}>
          <div className="card-section-heading">
            <div>
              <span className="subtle-label">Knowledge spaces</span>
              <h2>知识库概览</h2>
            </div>
            <Button type="link" onClick={() => navigate('/knowledge')}>
              查看全部 <ArrowRightOutlined />
            </Button>
          </div>
          <div className="knowledge-overview-list">
            {knowledgeBases.slice(0, 4).map((knowledgeBase, index) => (
              <button
                type="button"
                key={knowledgeBase.id}
                className="knowledge-overview-row"
                onClick={() => navigate(`/knowledge/${knowledgeBase.id}`)}
              >
                <span className={`knowledge-overview-row__icon tone-${index + 1}`}>
                  <DatabaseOutlined />
                </span>
                <div>
                  <strong>{knowledgeBase.name}</strong>
                  <small>
                    {knowledgeBase.documentCount} 个文件 · {knowledgeBase.chunkCount.toLocaleString('zh-CN')} 个分块
                  </small>
                </div>
                <StatusPill status={knowledgeBase.status} />
                <ArrowRightOutlined className="knowledge-overview-row__arrow" />
              </button>
            ))}
          </div>
        </Card>

        <Card className="activity-card surface-card" bordered={false}>
          <div className="card-section-heading">
            <div>
              <span className="subtle-label">Activity stream</span>
              <h2>最近任务</h2>
            </div>
            <Tag color="blue">实时</Tag>
          </div>
          <div className="activity-list">
            {recentActivities.map((activity) => (
              <div key={activity.id} className="activity-row">
                <span className={`activity-row__marker is-${activity.type}`}>
                  {activity.type === 'success' ? <CheckCircleFilled /> : activity.type === 'error' ? <AlertOutlined /> : <FireOutlined />}
                </span>
                <div>
                  <strong>{activity.title}</strong>
                  <small>{activity.description}</small>
                </div>
                <time>{activity.time}</time>
              </div>
            ))}
          </div>
        </Card>

        <Card className="attention-card surface-card" bordered={false}>
          <div className="attention-card__icon"><AlertOutlined /></div>
          <span className="subtle-label">Needs attention</span>
          <h2>2 项需要处理</h2>
          <p>扫描件存在 OCR 超时或额度不足，另有模型连接尚未通过测试。</p>
          <div className="attention-card__items">
            <span>导入失败 <b>2</b></span>
            <span>模型待处理 <b>{pendingProfiles}</b></span>
          </div>
          <Button type="primary" ghost block onClick={() => navigate(role === 'admin' ? '/logs' : '/knowledge/kb-product')}>
            立即处理
          </Button>
        </Card>
      </section>

      <Button
        className="dashboard-floating-action"
        type="primary"
        shape="circle"
        size="large"
        icon={<PlusOutlined />}
        aria-label="快速导入知识"
        onClick={() => navigate('/knowledge/kb-product/import')}
      />
    </div>
  );
}
