import { act, cleanup, render, screen } from '@testing-library/react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.location.hash = '';
  vi.useRealTimers();
});

describe('mock flows', () => {
  it('AIHubMix 第一次连接失败，再次点击成功', async () => {
    localStorage.setItem(ROLE_KEY, 'admin');
    renderAt('#/settings/models');
    const buttons = await screen.findAllByRole('button', { name: /测试连接/ });
    vi.useFakeTimers();
    await act(async () => {
      buttons[2].click();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText('鉴权失败：API Key 无效或账户额度不足')).toBeInTheDocument();

    const retryButtons = screen.getAllByRole('button', { name: /测试连接/ });
    await act(async () => {
      retryButtons[2].click();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByText('鉴权失败：API Key 无效或账户额度不足')).not.toBeInTheDocument();
  });

  it('无依据问题会很快结束并标记拒答', async () => {
    localStorage.setItem(ROLE_KEY, 'user');
    renderAt('#/chat');
    const ask = await screen.findByRole('button', { name: '如何申请海外差旅补贴？' });
    vi.useFakeTimers();
    await act(async () => {
      ask.click();
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByText('无足够依据 · 已拒答')).toBeInTheDocument();
    expect(screen.getByText(/没有找到足够依据/)).toBeInTheDocument();
  });

  it('在线对话保留原来的企业知识助手会话', async () => {
    localStorage.setItem(ROLE_KEY, 'user');
    renderAt('#/chat');
    expect(await screen.findByText('企业知识助手')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /部署需要多少服务器/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: '问答应用' })).not.toBeInTheDocument();
  });

  it('问答应用是独立板块，报告和客服只登记为即将推出', async () => {
    localStorage.setItem(ROLE_KEY, 'user');
    renderAt('#/apps');
    expect(await screen.findByRole('heading', { name: '问答应用' })).toBeInTheDocument();
    expect(screen.getByText('智能客服')).toBeInTheDocument();
    expect(screen.getByText('报告撰写')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '即将推出' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('企业知识助手')).not.toBeInTheDocument();
    expect(screen.queryByText('部署需要多少服务器？')).not.toBeInTheDocument();
  });
});
