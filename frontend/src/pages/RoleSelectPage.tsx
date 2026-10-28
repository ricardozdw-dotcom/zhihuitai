import {
  ArrowRightOutlined,
  CheckCircleFilled,
  DatabaseOutlined,
  LockOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { usePrototype } from '../context/PrototypeContext';
import type { Role } from '../types';
import './role-select-page.css';

interface RoleCard {
  id: Role;
  name: string;
  subtitle: string;
  description: string;
  features: string[];
  icon: React.ReactNode;
  tone: string;
  defaultPath: string;
}

const roleCards: RoleCard[] = [
  {
    id: 'admin',
    name: '管理员',
    subtitle: '平台配置与运行管理',
    description: '配置模型和 OCR，查看对话、Token、耗时、任务与系统健康。',
    features: ['模型与 OCR 配置', '全链路日志', '知识库与系统总览'],
    icon: <SettingOutlined />,
    tone: 'violet',
    defaultPath: '/dashboard',
  },
  {
    id: 'manager',
    name: '知识库管理人员',
    subtitle: '知识导入与质量验收',
    description: '维护知识库和文件，预览分块并通过检索测试验证知识质量。',
    features: ['文件导入与解析', '分块预览编辑', '检索效果测试'],
    icon: <DatabaseOutlined />,
    tone: 'blue',
    defaultPath: '/dashboard',
  },
  {
    id: 'user',
    name: '使用者',
    subtitle: '可信知识问答',
    description: '选择已发布知识库在线提问，查看可定位的原文引用。',
    features: ['多轮在线对话', '知识库选择', '原文引用定位'],
    icon: <MessageOutlined />,
    tone: 'green',
    defaultPath: '/chat',
  },
];

export default function RoleSelectPage() {
  const { setRole } = usePrototype();
  const navigate = useNavigate();

  const chooseRole = (card: RoleCard) => {
    setRole(card.id);
    navigate(card.defaultPath);
  };

  return (
    <div className="role-page">
      <div className="role-page__orb role-page__orb--one" />
      <div className="role-page__orb role-page__orb--two" />
      <header className="role-page__header">
        <div className="role-brand">
          <span className="role-brand__mark">知</span>
          <div>
            <strong>知汇台</strong>
            <small>企业知识库中台</small>
          </div>
        </div>
        <Tag icon={<SafetyCertificateOutlined />} color="processing">
          内网原型环境
        </Tag>
      </header>

      <main className="role-page__content">
        <section className="role-hero">
          <span className="role-hero__eyebrow">Knowledge Hub · Version 1.0</span>
          <h1>
            让企业知识从文件
            <br />
            变成<span>可信答案</span>
          </h1>
          <p>选择一个体验角色，进入对应的工作台。当前原型使用 Mock 数据，不连接真实模型或企业文件。</p>
          <div className="role-flow" aria-label="知识库处理流程">
            <span>导入知识</span>
            <ArrowRightOutlined />
            <span>解析与索引</span>
            <ArrowRightOutlined />
            <span>检索验证</span>
            <ArrowRightOutlined />
            <span>引用式问答</span>
          </div>
        </section>

        <section className="role-card-grid" aria-label="体验角色">
          {roleCards.map((card) => (
            <article key={card.id} className={`role-card role-card--${card.tone}`}>
              <div className="role-card__topline">
                <span className="role-card__icon">{card.icon}</span>
                <span className="role-card__mode">
                  <UserOutlined /> 角色视图
                </span>
              </div>
              <div className="role-card__title">
                <h2>{card.name}</h2>
                <span>{card.subtitle}</span>
              </div>
              <p>{card.description}</p>
              <ul>
                {card.features.map((feature) => (
                  <li key={feature}>
                    <CheckCircleFilled />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                type="primary"
                size="large"
                block
                iconPosition="end"
                icon={<ArrowRightOutlined />}
                onClick={() => chooseRole(card)}
              >
                以{card.name}进入
              </Button>
            </article>
          ))}
        </section>

        <aside className="role-security-note">
          <span>
            <LockOutlined />
          </span>
          <div>
            <strong>关于当前角色模式</strong>
            <p>
              V1.0 暂不包含登录与真实权限隔离。角色只控制菜单和操作入口，生产环境需接入身份系统或内网网关。
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
