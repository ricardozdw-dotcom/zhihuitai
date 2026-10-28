import {
  ApiOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  KeyOutlined,
  LinkOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { usePrototype } from '../context/PrototypeContext';
import type { ProviderProfile } from '../types';
import './settings-logs.css';

type Capability = ProviderProfile['capability'];

interface ProfileFormValue {
  provider: ProviderProfile['provider'];
  name: string;
  model: string;
  endpoint: string;
  apiKey: string;
  dimension?: number;
}

const capabilityMeta: Record<
  Capability,
  { label: string; description: string; icon: React.ReactNode }
> = {
  LLM: {
    label: 'LLM 模型',
    description: '负责对话理解、上下文组织与最终答案生成。',
    icon: <ApiOutlined />,
  },
  Embedding: {
    label: 'Embedding',
    description: '负责将文档分块和用户问题转换为向量。',
    icon: <CloudServerOutlined />,
  },
  Rerank: {
    label: 'Rerank',
    description: '对召回候选进行精排，提高最终上下文相关性。',
    icon: <ReloadOutlined />,
  },
  OCR: {
    label: 'OCR 服务',
    description: '识别扫描 PDF、图片和表格中的文字与结构。',
    icon: <EyeInvisibleOutlined />,
  },
};

const providerColors: Record<ProviderProfile['provider'], string> = {
  OpenRouter: '#6E5AE6',
  AIHubMix: '#2384D6',
  通义百炼: '#5B67F1',
  '阿里云 OCR': '#F17D36',
};

const providerOptions: Record<Capability, ProviderProfile['provider'][]> = {
  LLM: ['通义百炼', 'OpenRouter', 'AIHubMix'],
  Embedding: ['通义百炼', 'OpenRouter', 'AIHubMix'],
  Rerank: ['通义百炼', 'OpenRouter', 'AIHubMix'],
  OCR: ['阿里云 OCR'],
};

function EmptyCapability({
  capability,
  onCreate,
}: {
  capability: Capability;
  onCreate: () => void;
}) {
  return (
    <div className="provider-empty">
      <strong>尚未配置{capabilityMeta[capability].label}</strong>
      <p>添加端点并通过连接测试后，对应能力才会进入业务链路。</p>
      <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
        新增配置
      </Button>
    </div>
  );
}

function providerInitial(provider: ProviderProfile['provider']) {
  if (provider === '通义百炼') return 'Q';
  if (provider === '阿里云 OCR') return 'O';
  return provider.slice(0, 1);
}

export function ModelSettingsPage() {
  const { message, modal } = App.useApp();
  const {
    providerProfiles: profiles,
    setProviderProfiles,
    ocrQuotaPages,
    setOcrQuotaPages,
  } = usePrototype();
  const [capability, setCapability] = useState<Capability>('LLM');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProviderProfile | null>(null);
  const [form] = Form.useForm<ProfileFormValue>();
  const failedOnce = useRef(new Set<string>());

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => profile.capability === capability),
    [capability, profiles],
  );

  const healthyCount = profiles.filter((profile) => profile.status === 'healthy').length;

  const openCreateDrawer = () => {
    setEditingProfile(null);
    form.resetFields();
    form.setFieldsValue({
      provider: providerOptions[capability][0],
      endpoint:
        capability === 'OCR'
          ? 'ocr-api.cn-hangzhou.aliyuncs.com'
          : 'https://{workspace}.cn-beijing.maas.aliyuncs.com/compatible-api/v1',
      dimension: capability === 'Embedding' ? 1024 : undefined,
    });
    setDrawerOpen(true);
  };

  const openEditDrawer = (profile: ProviderProfile) => {
    setEditingProfile(profile);
    form.setFieldsValue({
      provider: profile.provider,
      name: profile.name,
      model: profile.model,
      endpoint: profile.endpoint,
      apiKey: '••••••••••••••••••••••••',
      dimension: profile.dimension,
    });
    setDrawerOpen(true);
  };

  const runConnectionTest = (profile: ProviderProfile) => {
    if (testingId) return;
    setTestingId(profile.id);
    window.setTimeout(() => {
      const shouldFail = profile.provider === 'AIHubMix' && !failedOnce.current.has(profile.id);
      try {
        if (shouldFail) {
          failedOnce.current.add(profile.id);
          setProviderProfiles((current) =>
            current.map((item) =>
              item.id === profile.id
                ? {
                    ...item,
                    status: 'error',
                    latencyMs: undefined,
                    lastChecked: '刚刚',
                    errorMessage: '鉴权失败：API Key 无效或账户额度不足',
                  }
                : item,
            ),
          );
          void message.error('连接失败：API Key 无效或额度不足，请检查后重试');
          return;
        }
        const latency = profile.capability === 'OCR' ? 1186 : 160 + Math.round(Math.random() * 420);
        setProviderProfiles((current) =>
          current.map((item) =>
            item.id === profile.id
              ? {
                  ...item,
                  status: 'healthy',
                  latencyMs: latency,
                  lastChecked: '刚刚',
                  errorMessage: undefined,
                }
              : item,
          ),
        );
        void message.success(`连接成功，响应耗时 ${latency} ms`);
      } finally {
        setTestingId(null);
      }
    }, 450);
  };

  const saveProfile = async () => {
    const values = await form.validateFields();
    if (editingProfile) {
      setProviderProfiles((current) =>
        current.map((profile) =>
          profile.id === editingProfile.id
            ? {
                ...profile,
                provider: values.provider,
                name: values.name,
                model: values.model,
                endpoint: values.endpoint,
                dimension: values.dimension,
                status: 'untested',
                latencyMs: undefined,
                lastChecked: undefined,
              }
            : profile,
        ),
      );
      message.success('配置已更新，请重新测试连接');
    } else {
      const nextProfile: ProviderProfile = {
        id: `profile-${capability.toLowerCase()}-${Date.now()}`,
        provider: values.provider,
        capability,
        name: values.name,
        model: values.model,
        endpoint: values.endpoint,
        status: 'untested',
        dimension: values.dimension,
      };
      setProviderProfiles((current) => [nextProfile, ...current]);
      message.success('配置已添加，请测试连接后启用');
    }
    setDrawerOpen(false);
  };

  const removeProfile = (profile: ProviderProfile) => {
    modal.confirm({
      title: `删除「${profile.name}」？`,
      content: '删除最后一个可用对话模型后，在线对话会进入未配置状态。此操作只影响本次原型会话。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        setProviderProfiles((current) => current.filter((item) => item.id !== profile.id));
        void message.success('配置已删除');
      },
    });
  };

  const llmReady = profiles.some(
    (profile) => profile.capability === 'LLM' && profile.status === 'healthy',
  );

  return (
    <div className="app-page settings-page">
      <PageHeader
        eyebrow="系统配置"
        title="模型与 OCR 配置"
        description="按能力分别维护模型端点、密钥和调用参数。密钥仅在后端解密，前端不会显示完整内容。"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDrawer}>
            新增配置
          </Button>
        }
      />

      <Alert
        className="settings-security-alert"
        type="warning"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="数据边界提醒"
        description="OpenRouter 与 AIHubMix 仅建议用于非敏感或已脱敏知识库；敏感内容默认路由至指定中国大陆地域的通义百炼与阿里云 OCR。"
        action={<Button size="small">查看路由策略</Button>}
      />

      <section className="settings-summary-grid" aria-label="模型配置概览">
        <Card className="settings-summary-card surface-card" bordered={false}>
          <div className="settings-summary-card__icon settings-summary-card__icon--healthy">
            <CheckCircleFilled />
          </div>
          <div>
            <span>可用配置</span>
            <strong>{healthyCount}</strong>
            <small>共 {profiles.length} 个配置</small>
          </div>
        </Card>
        <Card className="settings-summary-card surface-card" bordered={false}>
          <div className="settings-summary-card__icon settings-summary-card__icon--secure">
            <LockOutlined />
          </div>
          <div>
            <span>密钥保护</span>
            <strong>已启用</strong>
            <small>AES-256 加密存储</small>
          </div>
        </Card>
        <Card className="settings-summary-card surface-card" bordered={false}>
          <div className="settings-summary-card__icon settings-summary-card__icon--route">
            <LinkOutlined />
          </div>
          <div>
            <span>生产路由</span>
            <strong>中国大陆</strong>
            <small>敏感知识库默认策略</small>
          </div>
        </Card>
      </section>

      <Card className="settings-content-card surface-card" bordered={false}>
        <Tabs
          activeKey={capability}
          onChange={(key) => setCapability(key as Capability)}
          items={(Object.keys(capabilityMeta) as Capability[]).map((key) => ({
            key,
            label: (
              <span className="settings-tab-label">
                {capabilityMeta[key].icon}
                {capabilityMeta[key].label}
              </span>
            ),
          }))}
        />

        <div className="settings-capability-heading">
          <div>
            <h2>{capabilityMeta[capability].label}</h2>
            <p>{capabilityMeta[capability].description}</p>
          </div>
          <span>{visibleProfiles.length} 个配置</span>
        </div>

        {capability === 'LLM' && !llmReady ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            showIcon
            message="对话模型未配置"
            description="在线对话需要至少一个连接正常的 LLM。新增或修改配置后，请先测试连接。"
          />
        ) : null}
        {capability === 'OCR' ? (
          <Alert
            style={{ marginBottom: 16 }}
            type={ocrQuotaPages < 40 ? 'error' : 'success'}
            showIcon
            message={ocrQuotaPages < 40 ? 'OCR 额度不足' : 'OCR 额度充足'}
            description={`本月剩余 ${ocrQuotaPages} 页 / 1000 页。扫描 PDF、图片和文档内图片会消耗额度。`}
            action={
              ocrQuotaPages < 40 ? (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    setOcrQuotaPages(500);
                    void message.success('已补充 OCR 额度（原型）');
                  }}
                >
                  补充额度
                </Button>
              ) : (
                <Button size="small" onClick={() => setOcrQuotaPages(12)}>
                  模拟额度耗尽
                </Button>
              )
            }
          />
        ) : null}

        <Row gutter={[16, 16]}>
          {visibleProfiles.length === 0 ? (
            <Col span={24}>
              <EmptyCapability capability={capability} onCreate={openCreateDrawer} />
            </Col>
          ) : null}
          {visibleProfiles.map((profile) => (
            <Col span={visibleProfiles.length === 1 ? 12 : 8} key={profile.id}>
              <Card className="provider-card" bordered={false}>
                <div className="provider-card__header">
                  <div className="provider-identity">
                    <div
                      className="provider-avatar"
                      style={{ background: providerColors[profile.provider] }}
                    >
                      {providerInitial(profile.provider)}
                    </div>
                    <div>
                      <strong>{profile.name}</strong>
                      <span>{profile.provider}</span>
                    </div>
                  </div>
                  <StatusPill status={profile.status} />
                </div>

                <div className="provider-card__model">
                  <span>模型 / 服务</span>
                  <strong>{profile.model}</strong>
                </div>

                <div className="provider-card__endpoint">
                  <LinkOutlined />
                  <Tooltip title={profile.endpoint}>
                    <span>{profile.endpoint}</span>
                  </Tooltip>
                </div>

                {profile.dimension ? (
                  <div className="provider-card__meta-row">
                    <span>向量维度</span>
                    <Tag color="geekblue">{profile.dimension}d</Tag>
                  </div>
                ) : null}

                {profile.errorMessage ? (
                  <Alert
                    className="provider-card__error"
                    type="error"
                    showIcon
                    message={profile.errorMessage}
                  />
                ) : null}

                <div className="provider-card__meta-row">
                  <span>最近测试</span>
                  <span>
                    {profile.lastChecked ?? '尚未测试'}
                    {profile.latencyMs ? ` · ${profile.latencyMs} ms` : ''}
                  </span>
                </div>

                <Divider />

                <div className="provider-card__actions">
                  <Button
                    icon={<ReloadOutlined spin={testingId === profile.id} />}
                    loading={testingId === profile.id}
                    onClick={() => runConnectionTest(profile)}
                  >
                    测试连接
                  </Button>
                  <Button icon={<EditOutlined />} onClick={() => openEditDrawer(profile)}>
                    编辑
                  </Button>
                  <Button danger type="text" onClick={() => removeProfile(profile)}>
                    删除
                  </Button>
                </div>
              </Card>
            </Col>
          ))}

          <Col span={visibleProfiles.length === 1 ? 12 : 8}>
            <button className="provider-add-card" type="button" onClick={openCreateDrawer}>
              <span>
                <PlusOutlined />
              </span>
              <strong>新增{capabilityMeta[capability].label}配置</strong>
              <small>配置端点、模型和调用凭证</small>
            </button>
          </Col>
        </Row>
      </Card>

      <Drawer
        title={editingProfile ? `编辑 ${editingProfile.name}` : `新增${capabilityMeta[capability].label}配置`}
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={saveProfile}>
              保存配置
            </Button>
          </Space>
        }
      >
        <div className="settings-drawer-intro">
          <div className="settings-drawer-intro__icon">
            <SettingOutlined />
          </div>
          <div>
            <strong>{capabilityMeta[capability].label}</strong>
            <p>{capabilityMeta[capability].description} 保存后需通过连接测试才会启用。</p>
          </div>
        </div>

        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            label="服务供应商"
            name="provider"
            rules={[{ required: true, message: '请选择服务供应商' }]}
          >
            <Select
              options={providerOptions[capability].map((provider) => ({
                label: provider,
                value: provider,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="配置名称"
            name="name"
            rules={[{ required: true, message: '请输入便于识别的配置名称' }]}
          >
            <Input placeholder="例如：生产对话模型" />
          </Form.Item>
          <Form.Item
            label={capability === 'OCR' ? '服务 / API 名称' : '模型 ID'}
            name="model"
            rules={[{ required: true, message: '请输入模型或服务名称' }]}
          >
            <Input placeholder={capability === 'OCR' ? 'RecognizeDocumentStructure' : 'qwen3-max'} />
          </Form.Item>
          <Form.Item
            label="API Endpoint"
            name="endpoint"
            rules={[
              { required: true, message: '请输入 API Endpoint' },
              { min: 8, message: '请输入完整 Endpoint' },
            ]}
          >
            <Input prefix={<LinkOutlined />} placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item
            label="API Key"
            name="apiKey"
            rules={[{ required: true, message: '请输入 API Key' }]}
            extra="密钥将在后端加密保存，日志与前端响应均不会包含原文。"
          >
            <Input.Password prefix={<KeyOutlined />} placeholder="sk-••••••••••••••••" />
          </Form.Item>
          {capability === 'Embedding' ? (
            <Form.Item
              label="向量维度"
              name="dimension"
              rules={[{ required: true, message: '请输入向量维度' }]}
              extra="知识库创建后会锁定模型与维度，更换配置必须新建索引版本。"
            >
              <InputNumber min={128} max={4000} step={128} style={{ width: '100%' }} />
            </Form.Item>
          ) : null}
        </Form>
      </Drawer>
    </div>
  );
}
