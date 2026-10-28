export type ScenarioId = 'qa' | 'service' | 'report';

export type ScenarioKind = 'chatbot' | 'agent';

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  description: string;
  kind: ScenarioKind;
  icon: 'message' | 'customer' | 'file';
  status: 'available' | 'coming_soon';
  entryPath: string;
  assistantName: string;
  promptLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  welcomeMessage: string;
  suggestedQuestions: string[];
  composerPlaceholder: string;
}

export const scenarioKindLabel: Record<ScenarioKind, string> = {
  chatbot: 'Chatbot',
  agent: 'Agent',
};

export const scenarios: ScenarioDefinition[] = [
  {
    id: 'qa',
    name: '问答助手',
    description: '选择已发布知识库进行多轮提问，回答附带可定位的原文引用。',
    kind: 'chatbot',
    icon: 'message',
    status: 'available',
    entryPath: '/apps/qa',
    assistantName: '问答助手',
    promptLabel: 'Chatbot · qwen3-max',
    emptyTitle: '开始一次场景问答',
    emptyDescription: '这是问答应用里的 Chatbot 场景，与左侧「在线对话」互相独立。',
    welcomeMessage: '已创建问答助手会话。请选择知识库后提问，回答会标注可追溯的原文。',
    suggestedQuestions: [
      '系统支持哪些文件格式？',
      'Rerank 在什么情况下生效？',
      '如何申请海外差旅补贴？',
    ],
    composerPlaceholder: '向问答助手提问，按 Enter 发送…',
  },
  {
    id: 'service',
    name: '智能客服',
    description: '面向咨询场景的多轮客服机器人，后续可接入转人工与工单。',
    kind: 'chatbot',
    icon: 'customer',
    status: 'coming_soon',
    entryPath: '/apps/service',
    assistantName: '智能客服',
    promptLabel: '尚未开放',
    emptyTitle: '智能客服即将推出',
    emptyDescription: '客服场景已登记为 Chatbot。当前版本只开放问答助手，避免先做一个假的客服台。',
    welcomeMessage: '',
    suggestedQuestions: [],
    composerPlaceholder: '',
  },
  {
    id: 'report',
    name: '报告撰写',
    description: '按知识库整理材料，生成可复核的结构化报告。',
    kind: 'agent',
    icon: 'file',
    status: 'coming_soon',
    entryPath: '/apps/report',
    assistantName: '报告撰写',
    promptLabel: '尚未开放',
    emptyTitle: '报告撰写即将推出',
    emptyDescription: '报告场景已登记为 Agent。当前只保留入口，不会假装已经能写完整报告。',
    welcomeMessage: '',
    suggestedQuestions: [],
    composerPlaceholder: '',
  },
];

const scenarioMap = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export function getScenario(id: string | undefined) {
  if (!id) return undefined;
  return scenarioMap.get(id as ScenarioId);
}

export const qaScenario = scenarios[0];
