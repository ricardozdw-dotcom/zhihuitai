import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter } from 'react-router-dom';
import { PrototypeProvider } from './context/PrototypeContext';
import App from './app/App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#5B67F1',
          colorInfo: '#5B67F1',
          colorSuccess: '#20A779',
          colorWarning: '#E7A13D',
          colorError: '#E65F5C',
          borderRadius: 10,
          borderRadiusLG: 16,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: {
            controlHeight: 40,
            controlHeightSM: 32,
            fontWeight: 600,
          },
          Card: {
            paddingLG: 22,
          },
          Table: {
            headerBg: '#F7F8FC',
            headerColor: '#6B7280',
            rowHoverBg: '#F8F8FF',
          },
        },
      }}
    >
      <AntdApp>
        <HashRouter>
          <PrototypeProvider>
            <App />
          </PrototypeProvider>
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
