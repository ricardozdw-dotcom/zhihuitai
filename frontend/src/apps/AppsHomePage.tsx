import { ArrowRightOutlined, CustomerServiceOutlined, FileTextOutlined, MessageOutlined } from '@ant-design/icons';
import { Button, Tag } from 'antd';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import {
  scenarioKindLabel,
  scenarios,
  type ScenarioDefinition,
} from '../scenarios/registry';
import './apps-home.css';

const icons: Record<ScenarioDefinition['icon'], ReactNode> = {
  message: <MessageOutlined />,
  customer: <CustomerServiceOutlined />,
  file: <FileTextOutlined />,
};

export function AppsHomePage() {
  const navigate = useNavigate();

  return (
    <div className="app-page apps-home">
      <PageHeader
        eyebrow="Scenario studio"
        title="问答应用"
        description="在知识库之上单独建设智能场景。场景可以是 Chatbot，也可以是 Agent，例如智能客服、报告撰写。这里不替换原来的在线对话。"
      />
      <div className="apps-home__grid">
        {scenarios.map((scenario) => {
          const available = scenario.status === 'available';
          return (
            <article key={scenario.id} className="apps-card">
              <header>
                <span className={`apps-card__icon apps-card__icon--${scenario.icon}`}>
                  {icons[scenario.icon]}
                </span>
                <div>
                  <strong>{scenario.name}</strong>
                  <div className="apps-card__tags">
                    <Tag color={scenario.kind === 'agent' ? 'purple' : 'blue'}>
                      {scenarioKindLabel[scenario.kind]}
                    </Tag>
                    <Tag color={available ? 'green' : 'default'}>
                      {available ? '可用' : '即将推出'}
                    </Tag>
                  </div>
                </div>
              </header>
              <p>{scenario.description}</p>
              <Button
                type={available ? 'primary' : 'default'}
                disabled={!available}
                icon={available ? <ArrowRightOutlined /> : undefined}
                onClick={() => navigate(scenario.entryPath)}
              >
                {available ? '进入场景' : '即将推出'}
              </Button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
