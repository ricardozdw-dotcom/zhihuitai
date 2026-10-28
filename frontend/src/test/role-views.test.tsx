import { cleanup, render, screen, within } from '@testing-library/react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HashRouter } from 'react-router-dom';
import App from '../app/App';
import { PrototypeProvider } from '../context/PrototypeContext';

const ROLE_KEY = 'knowledge-hub:prototype:role:v1';

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <HashRouter>
          <PrototypeProvider>
            <App />
          </PrototypeProvider>
        </HashRouter>
      </AntdApp>
    </ConfigProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/roles';
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = '';
});

describe('角色视图', () => {
  it('未选择角色时展示三种角色入口', async () => {
    renderAt('#/roles');
    expect(await screen.findByRole('heading', { name: '管理员' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '知识库管理人员' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '使用者' })).toBeInTheDocument();
  });

  it('管理员可以看到模型配置和可观测入口', async () => {
    localStorage.setItem(ROLE_KEY, 'admin');
    renderAt('#/dashboard');
    expect(await screen.findByText('可观测')).toBeInTheDocument();
    expect(screen.getByText('模型配置')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '早上好，管理员' })).toBeInTheDocument();
  });

  it('使用者进入对话，并且看不到管理菜单', async () => {
    localStorage.setItem(ROLE_KEY, 'user');
    renderAt('#/logs');
    expect(await screen.findByText('企业知识助手')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getByText('在线对话')).toBeInTheDocument();
    expect(within(nav).getByText('问答应用')).toBeInTheDocument();
    expect(within(nav).queryByText('可观测')).not.toBeInTheDocument();
    expect(within(nav).queryByText('模型配置')).not.toBeInTheDocument();
    expect(within(nav).queryByText('知识库')).not.toBeInTheDocument();
    expect(within(nav).queryByText('总览')).not.toBeInTheDocument();
  });

  it('知识库管理人员可见观测入口，但看不到模型配置', async () => {
    localStorage.setItem(ROLE_KEY, 'manager');
    renderAt('#/knowledge');
    expect(await screen.findByRole('heading', { name: '知识库' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getByText('知识库')).toBeInTheDocument();
    expect(within(nav).getByText('在线对话')).toBeInTheDocument();
    expect(within(nav).getByText('问答应用')).toBeInTheDocument();
    expect(within(nav).queryByText('模型配置')).not.toBeInTheDocument();
    expect(within(nav).getByText('可观测')).toBeInTheDocument();
  });
});
