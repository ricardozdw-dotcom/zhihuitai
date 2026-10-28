import {
  ApiOutlined,
  BellOutlined,
  BookOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  FileSearchOutlined,
  ExperimentOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Popover, Tooltip } from 'antd';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleHome, roleNames } from '../app/roles';
import { usePrototype } from '../context/PrototypeContext';
import type { Role } from '../types';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
}

const navItems: NavItem[] = [
  {
    to: '/dashboard',
    label: '总览',
    icon: <DashboardOutlined />,
    roles: ['admin', 'manager'],
  },
  {
    to: '/knowledge',
    label: '知识库',
    icon: <BookOutlined />,
    roles: ['admin', 'manager'],
  },
  {
    to: '/chat',
    label: '在线对话',
    icon: <MessageOutlined />,
    roles: ['admin', 'manager', 'user'],
  },
  {
    to: '/apps',
    label: '问答应用',
    icon: <AppstoreOutlined />,
    roles: ['admin', 'manager', 'user'],
  },
  {
    to: '/settings/models',
    label: '模型配置',
    icon: <ApiOutlined />,
    roles: ['admin'],
  },
  {
    to: '/observability',
    label: '可观测',
    icon: <FileSearchOutlined />,
    roles: ['admin', 'manager'],
  },
  {
    to: '/evaluations',
    label: '评测集',
    icon: <ExperimentOutlined />,
    roles: ['admin'],
  },
];

const pageNames: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /^\/dashboard/, name: '运营总览' },
  { pattern: /^\/knowledge\/.+\/import/, name: '导入知识' },
  { pattern: /^\/knowledge\/.+/, name: '知识库详情' },
  { pattern: /^\/knowledge/, name: '知识库' },
  { pattern: /^\/apps/, name: '问答应用' },
  { pattern: /^\/chat/, name: '在线对话' },
  { pattern: /^\/settings/, name: '模型与 OCR 配置' },
  { pattern: /^\/logs/, name: '日志中心' },
  { pattern: /^\/observability/, name: '可观测中心' },
  { pattern: /^\/evaluations/, name: '评测集与 Case 回流' },
];

export function AppShell() {
  const { role, setRole } = usePrototype();
  const navigate = useNavigate();
  const location = useLocation();
  const visibleItems = navItems.filter((item) => role && item.roles.includes(role));
  const currentPage = pageNames.find((item) => item.pattern.test(location.pathname))?.name;
  const homePath = roleHome(role);

  const rolePanel = (
    <div className="role-popover">
      <div className="role-popover__eyebrow">当前体验角色</div>
      <strong>{role ? roleNames[role] : '尚未选择'}</strong>
      <p>原型阶段仅切换功能视图，不代表真实安全权限。</p>
      <Button
        block
        icon={<SwapOutlined />}
        onClick={() => {
          setRole(null);
          navigate('/roles');
        }}
      >
        切换角色
      </Button>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <button className="brand-mark" type="button" onClick={() => navigate(homePath)}>
          <span>知</span>
        </button>
        <nav className="app-nav" aria-label="主导航">
          {visibleItems.map((item) => (
            <Tooltip key={item.to} title={item.label} placement="right">
              <NavLink
                to={item.to}
                className={({ isActive }) => {
                  const active =
                    item.to === '/apps' ? location.pathname.startsWith('/apps') : isActive;
                  return `app-nav__item${active ? ' is-active' : ''}`;
                }}
              >
                <span className="app-nav__icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            </Tooltip>
          ))}
        </nav>
        <div className="app-rail__bottom">
          <Tooltip title="内网体验模式" placement="right">
            <span className="security-indicator">
              <SafetyCertificateOutlined />
            </span>
          </Tooltip>
          <Popover content={rolePanel} trigger="click" placement="rightBottom">
            <button className="role-switcher" type="button" aria-label="切换体验角色">
              <Avatar size={38} icon={<UserOutlined />} />
              <span>{role ? roleNames[role].slice(0, 3) : '角色'}</span>
            </button>
          </Popover>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div>
            <span className="app-topbar__product">知汇台</span>
            <span className="app-topbar__divider" />
            <span className="app-topbar__page">{currentPage ?? '企业知识库中台'}</span>
          </div>
          <div className="app-topbar__actions">
            <span className="prototype-badge">
              <span /> 角色视图 · {role ? roleNames[role] : '未选择'}
            </span>
            <Tooltip title="使用帮助">
              <Button type="text" shape="circle" icon={<QuestionCircleOutlined />} />
            </Tooltip>
            <Tooltip title="通知">
              <Button type="text" shape="circle" icon={<BellOutlined />} />
            </Tooltip>
            <Tooltip title={role === 'admin' ? '模型与 OCR 配置' : '当前角色视图不含系统配置'}>
              <Button
                type="text"
                shape="circle"
                icon={<SettingOutlined />}
                aria-label="系统设置"
                onClick={() => navigate(role === 'admin' ? '/settings/models' : homePath)}
              />
            </Tooltip>
          </div>
        </header>
        <main className="app-main">
          {import.meta.env.VITE_DEPLOYMENT_MODE === 'github-pages' ? <aside className="deployment-notice" role="note"><strong>GitHub 在线演示</strong><span>使用演示数据，Case 仅保存在当前浏览器。服务端共享、真实问答与构建日志请在完整测试环境验证。</span><a href="https://github.com/ricardozdw-dotcom/zhihuitai/blob/main/docs/05-GitHub部署与在线测试.md" target="_blank" rel="noreferrer">完整功能测试说明 ↗</a></aside> : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
