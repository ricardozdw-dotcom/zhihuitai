import {
  CustomerServiceOutlined,
  FileTextOutlined,
  LeftOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { Button, Tag } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getScenario, qaScenario, scenarios, type ScenarioDefinition } from '../scenarios/registry';
import { ChatbotWorkspace } from './ChatbotWorkspace';
import './qa-app.css';

const scenarioIcons: Record<ScenarioDefinition['icon'], ReactNode> = {
  message: <MessageOutlined />,
  customer: <CustomerServiceOutlined />,
  file: <FileTextOutlined />,
};

function ComingSoon({ scenario }: { scenario: ScenarioDefinition }) {
  const actionLabel = scenario.kind === 'agent' ? '开始撰写' : '开始对话';
  return (
    <section className="qa-report" aria-label={scenario.name}>
      <div className="qa-report__card">
        <Tag>即将推出</Tag>
        <h1>{scenario.emptyTitle}</h1>
        <p>{scenario.description}</p>
        <p>{scenario.emptyDescription}</p>
        <Button type="primary" disabled>
          {actionLabel}
        </Button>
      </div>
    </section>
  );
}

export function QaApplicationPage() {
  const { scenarioId } = useParams();
  const navigate = useNavigate();
  const scenario = getScenario(scenarioId);
  if (!scenario) return <Navigate to="/apps" replace />;

  return (
    <div className="qa-app">
      <nav className="qa-app__switcher" aria-label="应用场景">
        <button type="button" className="qa-app__back" onClick={() => navigate('/apps')}>
          <LeftOutlined />
          应用列表
        </button>
        {scenarios.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`qa-app__scenario${item.id === scenario.id ? ' is-active' : ''}`}
            aria-pressed={item.id === scenario.id}
            onClick={() => navigate(item.entryPath)}
          >
            <span className="qa-app__scenario-icon">{scenarioIcons[item.icon]}</span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.status === 'available' ? '可用' : '即将推出'}</small>
            </span>
          </button>
        ))}
      </nav>
      <div
        className={scenario.id === 'qa' ? 'qa-app__body' : 'qa-app__body is-hidden'}
        aria-hidden={scenario.id !== 'qa'}
      >
        <ChatbotWorkspace scenario={qaScenario} />
      </div>
      {scenario.status === 'coming_soon' ? <ComingSoon scenario={scenario} /> : null}
    </div>
  );
}
