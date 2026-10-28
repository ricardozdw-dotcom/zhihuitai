import {
  CheckCircleFilled,
  CloseOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DislikeOutlined,
  FileTextOutlined,
  LikeOutlined,
  MessageOutlined,
  MoreOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Avatar,
  Button,
  Divider,
  Dropdown,
  Empty,
  Input,
  Progress,
  Select,
  Tag,
  Tooltip,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrototype } from '../context/PrototypeContext';
import { initialMessages } from '../data/mock';
import type { ChatMessage, Citation, Conversation, QueryLog } from '../types';
import type { ScenarioDefinition } from '../scenarios/registry';
import '../pages/chat-page.css';

const { TextArea } = Input;

const emptyMessages: ChatMessage[] = [];

interface ScenarioConversation extends Conversation {
  scenarioId: ScenarioDefinition['id'];
}

function seedFor(scenario: ScenarioDefinition): {
  conversations: ScenarioConversation[];
  messages: Record<string, ChatMessage[]>;
} {
  const id = `scenario-${scenario.id}-001`;
  return {
    conversations: [
      {
        id,
        title: '新对话',
        updatedAt: '刚刚',
        knowledgeBaseIds: ['kb-product'],
        scenarioId: scenario.id,
      },
    ],
    messages: {
      [id]: [
        {
          id: `welcome-${scenario.id}`,
          role: 'assistant',
          content: scenario.welcomeMessage,
          time: '10:40',
        },
      ],
    },
  };
}

const formatCitations: Citation[] = [
  {
    id: 'citation-format-1',
    index: 1,
    source: '知识库中台产品手册_V1.0.docx',
    locator: '第 12 页 · 3.2 节',
    score: 0.967,
    excerpt:
      '系统支持 Word、PDF、Markdown、图片和表格文件。对于扫描 PDF 与图片，系统会调用已配置的云端 OCR 服务进行文字与表格识别。',
    fileType: 'DOCX',
  },
  {
    id: 'citation-format-2',
    index: 2,
    source: '常见问题与标准答复.md',
    locator: '文件导入 / Q1',
    score: 0.884,
    excerpt:
      'Markdown 中的相对图片需与正文一起通过 ZIP 或文件夹上传；表格支持 XLSX、XLS、CSV 和 TSV。',
    fileType: 'MD',
  },
];

const logCitations: Citation[] = [
  {
    id: 'citation-log-1',
    index: 1,
    source: '常见问题与标准答复.md',
    locator: '日志与隐私 / Q3',
    score: 0.943,
    excerpt:
      '管理员可配置问题与回答正文的记录策略，包括全文、脱敏或不记录。默认保留期为 90 天，Token 与各阶段耗时会用于质量分析。',
    fileType: 'MD',
  },
];

const retrievalCitations: Citation[] = [
  {
    id: 'citation-retrieval-1',
    index: 1,
    source: '知识库中台产品手册_V1.0.docx',
    locator: '第 18 页 · 4.1 节',
    score: 0.958,
    excerpt:
      '用户问题进入检索链路后，先执行语义召回与关键词召回，再通过 RRF 合并候选结果。启用 Rerank 时，系统会对候选内容重新排序。',
    fileType: 'DOCX',
  },
];

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildResponse(question: string): {
  answer: string;
  citations: Citation[];
  noEvidence?: boolean;
} {
  if (/补贴|股权|火星/.test(question)) {
    return {
      answer:
        '在已选择的知识库里没有找到足够依据回答这个问题。我不会根据常识编造制度或事实。建议补充相关文件，或把问题改得更具体后再试。',
      citations: [],
      noEvidence: true,
    };
  }

  if (/格式|文件|Word|PDF/i.test(question)) {
    return {
      answer:
        '通用版本支持 Word（DOC、DOCX）、PDF、Markdown、常见图片格式，以及 XLS、XLSX、CSV、TSV 表格文件。\n\n原生 PDF 会优先读取文本层；扫描 PDF、普通图片和文档内需要识字的图片会调用云端 OCR。Markdown 若引用相对路径图片，需要将正文与资源文件一起上传。宏、公式重算和图表语义理解不属于当前版本范围。',
      citations: formatCitations,
    };
  }

  if (/日志|保留|Token|脱敏/i.test(question)) {
    return {
      answer:
        '对话日志默认保留 90 天。管理员可以选择记录完整问题与回答、仅保存脱敏正文，或完全不记录正文。\n\n无论正文策略如何，系统都会保存模型、Token、检索耗时、Rerank 耗时、首 Token 时间、总耗时和错误状态；供应商未返回精确 Token 时会明确标注为“估算”。',
      citations: logCitations,
    };
  }

  if (/Rerank|重排|检索/i.test(question)) {
    return {
      answer:
        'Rerank 位于初次召回之后：系统先做语义与关键词召回，再通过 RRF 合并候选结果，最后由 Rerank 模型重新评分并选出最相关的内容。\n\n它最适合候选结果较多、相关度参差不齐的场景。小知识库或低延迟模式可以关闭 Rerank，避免额外的云端调用。',
      citations: retrievalCitations,
    };
  }

  return {
    answer:
      '根据当前知识库，通用版本建议从单机 Docker Compose 部署起步，覆盖前端、API、解析 Worker、PostgreSQL 与 Redis。对于单组织、100 名以内使用者、20 路以内并发和 50 万分块以内的场景，这一方案能够兼顾交付速度与运维复杂度。\n\n随着导入任务增加，可以先横向扩展解析 Worker；只有当向量规模或并发明显超出边界时，再升级为独立向量数据库和多节点架构。',
    citations: initialMessages[2]?.citations ?? [],
  };
}

export function ChatbotWorkspace({ scenario }: { scenario: ScenarioDefinition }) {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const {
    role,
    knowledgeBases,
    selectedKnowledgeBaseIds,
    setSelectedKnowledgeBaseIds,
    providerProfiles,
    documentsByKnowledgeBase,
    addQueryLog,
  } = usePrototype();
  const [conversations, setConversations] = useState<ScenarioConversation[]>(
    () => seedFor(scenario).conversations,
  );
  const [activeConversationId, setActiveConversationId] = useState(
    () => seedFor(scenario).conversations[0].id,
  );
  const [conversationSearch, setConversationSearch] = useState('');
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, ChatMessage[]>
  >(() => seedFor(scenario).messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const timerRef = useRef<number | null>(null);
  const streamingConversationRef = useRef<string | null>(null);
  const forceFailureRef = useRef(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const messages = messagesByConversation[activeConversationId] ?? emptyMessages;
  const healthyLlm = providerProfiles.find(
    (profile) => profile.capability === 'LLM' && profile.status === 'healthy',
  );

  const availableKnowledgeBases = useMemo(
    () => knowledgeBases.filter((item) => item.status !== 'disabled'),
    [knowledgeBases],
  );
  const indexQuestions = useMemo(() => {
    const seen = new Set(scenario.suggestedQuestions);
    const extra: string[] = [];
    for (const knowledgeBaseId of selectedKnowledgeBaseIds) {
      for (const document of documentsByKnowledgeBase[knowledgeBaseId] ?? []) {
        for (const question of document.metadata.questions) {
          if (seen.has(question)) continue;
          seen.add(question);
          extra.push(question);
          if (extra.length >= 2) return extra;
        }
      }
    }
    return extra;
  }, [documentsByKnowledgeBase, scenario.suggestedQuestions, selectedKnowledgeBaseIds]);
  const scenarioConversations = useMemo(
    () => conversations.filter((item) => item.scenarioId === scenario.id),
    [conversations, scenario.id],
  );
  const filteredConversations = useMemo(() => {
    const keyword = conversationSearch.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return scenarioConversations;
    return scenarioConversations.filter((item) =>
      item.title.toLocaleLowerCase('zh-CN').includes(keyword),
    );
  }, [conversationSearch, scenarioConversations]);

  const clearStreamingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const patchMessages = useCallback(
    (conversationId: string, updater: (current: ChatMessage[]) => ChatMessage[]) => {
      setMessagesByConversation((all) => ({
        ...all,
        [conversationId]: updater(all[conversationId] ?? []),
      }));
    },
    [],
  );

  useEffect(() => clearStreamingTimer, [clearStreamingTimer]);

  const tailMessage = messages[messages.length - 1];
  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, tailMessage?.id, tailMessage?.content, activeConversationId]);

  const stopGeneration = useCallback(() => {
    const conversationId = streamingConversationRef.current;
    clearStreamingTimer();
    setIsStreaming(false);
    streamingConversationRef.current = null;
    if (!conversationId) return;
    patchMessages(conversationId, (current) =>
      current.map((item, index) =>
        index === current.length - 1 && item.role === 'assistant' && !item.failed
          ? { ...item, content: `${item.content}\n\n（已停止生成）` }
          : item,
      ),
    );
  }, [clearStreamingTimer, patchMessages]);

  const sendQuestion = useCallback(
    (question?: string) => {
      const value = (question ?? input).trim();
      if (!value || isStreaming) return;
      if (!healthyLlm) {
        void message.warning('对话模型未配置，请先完成连接测试');
        return;
      }
      if (!activeConversationId) {
        void message.warning('请先新建对话');
        return;
      }
      if (selectedKnowledgeBaseIds.length === 0) {
        void message.warning('请至少选择一个知识库');
        return;
      }

      const conversationId = activeConversationId;
      const time = nowTime();
      const selectedBases = knowledgeBases.filter((item) =>
        selectedKnowledgeBaseIds.includes(item.id),
      );
      const noIndexedChunks =
        selectedBases.length > 0 && selectedBases.every((item) => item.chunkCount === 0);
      const failed = forceFailureRef.current;
      forceFailureRef.current = false;
      const response = noIndexedChunks
        ? {
            answer:
              '所选知识库还没有可检索的分块。请先导入文件并等待索引完成，然后再提问。',
            citations: [],
            noEvidence: true,
          }
        : value.includes('模拟一次调用失败')
          ? {
              answer:
                '重试已成功。上一次请求在生成阶段超时，本次模型正常返回。可以到日志中心对比失败与成功两条链路。',
              citations: initialMessages[2]?.citations ?? [],
            }
          : buildResponse(value);
      const assistantId = `message-assistant-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: `message-user-${Date.now()}`,
        role: 'user',
        content: value,
        time,
      };
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        time,
      };
      const kbLabel = selectedBases.map((item) => item.name).join('、') || '未选择知识库';
      const writeLog = (status: QueryLog['status'], answer: string) => {
        addQueryLog({
          id: `log-${Date.now()}`,
          traceId: `tr_${Date.now().toString(16).slice(-8)}`,
          query: value,
          knowledgeBase: kbLabel,
          model: healthyLlm.model,
          provider: healthyLlm.provider,
          status,
          inputTokens: status === 'error' ? 640 : 860 + value.length * 3,
          outputTokens: status === 'error' ? 0 : Math.max(answer.length, 24),
          durationMs: status === 'error' ? 8000 : 1680,
          retrievalMs: 96,
          rerankMs: status === 'error' ? 0 : 180,
          firstTokenMs: status === 'error' ? 0 : 540,
          createdAt: formatStamp(),
          scenarioId: scenario.id,
        });
      };

      patchMessages(conversationId, (current) => [...current, userMessage, assistantPlaceholder]);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                title: item.title === '新对话' ? value.slice(0, 24) : item.title,
                updatedAt: '刚刚',
                knowledgeBaseIds: selectedKnowledgeBaseIds,
              }
            : item,
        ),
      );
      setInput('');
      setIsStreaming(true);
      setActiveCitation(null);
      streamingConversationRef.current = conversationId;

      if (failed) {
        timerRef.current = window.setTimeout(() => {
          patchMessages(conversationId, (current) =>
            current.map((item) =>
              item.id === assistantId
                ? { ...item, failed: true, content: '模型调用失败', latencyMs: 8000, tokenCount: 0 }
                : item,
            ),
          );
          clearStreamingTimer();
          setIsStreaming(false);
          streamingConversationRef.current = null;
          writeLog('error', '');
        }, 800);
        return;
      }

      let cursor = 0;
      const step = Math.max(24, Math.ceil(response.answer.length / 8));
      timerRef.current = window.setInterval(() => {
        cursor = Math.min(cursor + step, response.answer.length);
        const done = cursor >= response.answer.length;
        patchMessages(conversationId, (current) =>
          current.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: response.answer.slice(0, cursor),
                  ...(done
                    ? {
                        citations: response.citations,
                        noEvidence: response.noEvidence,
                        latencyMs: 1680,
                        tokenCount: Math.max(response.answer.length, 24),
                      }
                    : {}),
                }
              : item,
          ),
        );

        if (done) {
          clearStreamingTimer();
          setIsStreaming(false);
          streamingConversationRef.current = null;
          setActiveCitation(response.citations[0] ?? null);
          writeLog(response.noEvidence ? 'empty' : 'success', response.answer);
        }
      }, 40);
    },
    [
      activeConversationId,
      addQueryLog,
      clearStreamingTimer,
      healthyLlm,
      input,
      isStreaming,
      knowledgeBases,
      message,
      patchMessages,
      scenario.id,
      selectedKnowledgeBaseIds,
    ],
  );

  const createConversation = () => {
    stopGeneration();
    const nextConversation: ScenarioConversation = {
      id: `conversation-${Date.now()}`,
      title: '新对话',
      updatedAt: '刚刚',
      knowledgeBaseIds: selectedKnowledgeBaseIds,
      scenarioId: scenario.id,
    };
    setConversations((current) => [nextConversation, ...current]);
    setMessagesByConversation((current) => ({
      ...current,
      [nextConversation.id]: [
        {
          id: `welcome-${Date.now()}`,
          role: 'assistant',
          content: scenario.welcomeMessage,
          time: nowTime(),
        },
      ],
    }));
    setActiveConversationId(nextConversation.id);
    setActiveCitation(null);
  };

  const openConversation = (id: string) => {
    if (id === activeConversationId) return;
    if (isStreaming) stopGeneration();
    setActiveConversationId(id);
    const history = messagesByConversation[id] ?? [];
    const cited = [...history].reverse().find((item) => item.citations && item.citations.length > 0);
    setActiveCitation(cited?.citations?.[0] ?? null);
  };

  const removeConversation = (id: string) => {
    modal.confirm({
      title: '删除这个会话？',
      content: '会话记录会从本次原型中移除。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        if (streamingConversationRef.current === id) stopGeneration();
        setConversations((current) => current.filter((item) => item.id !== id));
        setMessagesByConversation((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        if (activeConversationId === id) {
          const fallback = conversations.find(
            (item) => item.id !== id && item.scenarioId === scenario.id,
          );
          setActiveConversationId(fallback?.id ?? '');
          setActiveCitation(null);
        }
        void message.success('会话已删除');
      },
    });
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      void message.success('回答已复制');
    } catch {
      void message.info('当前环境无法写入剪贴板');
    }
  };

  return (
    <div className="chat-page">
      <aside className="chat-sidebar">
        <div className="chat-sidebar__header">
          <div>
            <span>{scenario.name}</span>
            <small>{scenarioConversations.length} 个会话</small>
          </div>
          <Tooltip title="新建对话">
            <Button
              type="primary"
              shape="circle"
              icon={<PlusOutlined />}
              onClick={createConversation}
            />
          </Tooltip>
        </div>
        <Input
          className="chat-sidebar__search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索历史对话"
          value={conversationSearch}
          onChange={(event) => setConversationSearch(event.target.value)}
        />
        <div className="chat-conversation-list soft-scrollbar">
          {filteredConversations.length > 0 ? (
            filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`chat-conversation${
                  conversation.id === activeConversationId ? ' is-active' : ''
                }`}
                onClick={() => openConversation(conversation.id)}
              >
                <span className="chat-conversation__icon">
                  <MessageOutlined />
                </span>
                <span className="chat-conversation__body">
                  <strong>{conversation.title}</strong>
                  <small>{conversation.updatedAt}</small>
                </span>
                <span
                  className="chat-conversation__delete"
                  role="button"
                  tabIndex={0}
                  aria-label={`删除会话 ${conversation.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeConversation(conversation.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                      removeConversation(conversation.id);
                    }
                  }}
                >
                  <DeleteOutlined />
                </span>
              </button>
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的会话" />
          )}
        </div>
        <div className="chat-sidebar__privacy">
          <CheckCircleFilled />
          <span>
            当前日志策略
            <strong>完整记录 · 90 天</strong>
          </span>
        </div>
      </aside>

      <section className="chat-center">
        <header className="chat-toolbar">
          <div className="chat-toolbar__title">
            <Avatar icon={<ThunderboltOutlined />} />
            <div>
              <strong>{scenario.assistantName}</strong>
              <span>
                <i /> {scenario.promptLabel}
              </span>
            </div>
          </div>
          <div className="chat-toolbar__actions">
            <div className="knowledge-select-wrap">
              <DatabaseOutlined />
              <Select
                aria-label="选择知识库"
                mode="multiple"
                maxTagCount={1}
                value={selectedKnowledgeBaseIds}
                placeholder="选择知识库"
                options={availableKnowledgeBases.map((item) => ({
                  label: item.name,
                  value: item.id,
                }))}
                onChange={setSelectedKnowledgeBaseIds}
              />
            </div>
            <Dropdown
              menu={{
                items: [
                  { key: 'clear', label: '清空当前消息', icon: <DeleteOutlined /> },
                  { key: 'fail', label: '模拟一次调用失败', icon: <StopOutlined /> },
                  { key: 'export', label: '导出对话记录', icon: <FileTextOutlined /> },
                ],
                onClick: ({ key }) => {
                  if (key === 'clear') {
                    patchMessages(activeConversationId, () => []);
                    setActiveCitation(null);
                  } else if (key === 'fail') {
                    forceFailureRef.current = true;
                    sendQuestion('模拟一次调用失败');
                  } else {
                    void message.info('原型：已生成对话导出任务');
                  }
                },
              }}
            >
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
          </div>
        </header>

        {!healthyLlm ? (
          <Alert
            className="chat-unconfigured"
            type="warning"
            showIcon
            message="对话模型未配置"
            description={
              role === 'admin'
                ? '还没有连接正常的 LLM。请先在模型配置里保存配置并测试连接。'
                : '管理员尚未配置可用的对话模型。当前角色视图不能修改供应商设置。'
            }
            action={
              role === 'admin' ? (
                <Button size="small" type="primary" onClick={() => navigate('/settings/models')}>
                  去配置
                </Button>
              ) : undefined
            }
          />
        ) : null}

        <div className="chat-message-scroll soft-scrollbar">
          <div className="chat-message-container">
            <div className="chat-day-divider"><span>今天</span></div>
            {messages.length > 0 ? (
              messages.map((item, index) => {
                const currentIsStreaming =
                  isStreaming && index === messages.length - 1 && item.role === 'assistant';
                return (
                  <article
                    key={item.id}
                    className={`chat-message chat-message--${item.role}`}
                  >
                    {item.role === 'assistant' ? (
                      <Avatar className="chat-message__avatar" icon={<ThunderboltOutlined />} />
                    ) : null}
                    <div className="chat-message__content-wrap">
                      <div className="chat-message__meta">
                        <strong>{item.role === 'assistant' ? scenario.assistantName : '你'}</strong>
                        <span>{item.time}</span>
                      </div>
                      <div className="chat-message__bubble">
                        {item.failed ? (
                          <div className="chat-message__text chat-message__text--error">
                            模型调用失败：上游超时，没有返回正文。检索已经完成，可以重试。
                            <div>
                              <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={() => sendQuestion(messages[index - 1]?.content)}
                              >
                                重试
                              </Button>
                            </div>
                          </div>
                        ) : item.content ? (
                          <div className="chat-message__text">{item.content}</div>
                        ) : (
                          <div className="thinking-line">
                            <span />
                            <span />
                            <span />
                            <em>正在检索并组织答案</em>
                          </div>
                        )}
                        {currentIsStreaming && item.content ? <span className="streaming-caret" /> : null}
                      </div>
                      {item.noEvidence ? (
                        <Tag className="chat-evidence-tag" color="orange">
                          无足够依据 · 已拒答
                        </Tag>
                      ) : null}

                      {item.citations && item.citations.length > 0 ? (
                        <div className="chat-citations">
                          <div className="chat-citations__label">
                            <DatabaseOutlined /> 本回答引用 {item.citations.length} 条知识
                          </div>
                          <div className="chat-citations__list">
                            {item.citations.map((citation) => (
                              <button
                                key={citation.id}
                                type="button"
                                className={`citation-chip${
                                  activeCitation?.id === citation.id ? ' is-active' : ''
                                }`}
                                onClick={() => setActiveCitation(citation)}
                              >
                                <span>{citation.index}</span>
                                <strong>{citation.source}</strong>
                                <small>{citation.locator}</small>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {item.role === 'assistant' && item.content && !currentIsStreaming ? (
                        <div className="chat-message__footer">
                          {item.latencyMs ? (
                            <span>
                              {item.latencyMs / 1000}s · {item.tokenCount} Tokens
                            </span>
                          ) : <span />}
                          <div>
                            <Tooltip title="复制回答">
                              <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => void copyMessage(item.content)}
                              />
                            </Tooltip>
                            <Tooltip title="有帮助">
                              <Button
                                type="text"
                                size="small"
                                icon={<LikeOutlined />}
                                style={feedback[item.id] === 'up' ? { color: '#20a779' } : undefined}
                                onClick={() => {
                                  setFeedback((current) => ({ ...current, [item.id]: 'up' }));
                                  void message.success('已记录：回答有帮助');
                                }}
                              />
                            </Tooltip>
                            <Tooltip title="需要改进">
                              <Button
                                type="text"
                                size="small"
                                icon={<DislikeOutlined />}
                                style={feedback[item.id] === 'down' ? { color: '#e65f5c' } : undefined}
                                onClick={() => {
                                  setFeedback((current) => ({ ...current, [item.id]: 'down' }));
                                  void message.success('已记录：回答需要改进');
                                }}
                              />
                            </Tooltip>
                            <Tooltip title="重新生成">
                              <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={() => sendQuestion(messages[index - 1]?.content)}
                              />
                            </Tooltip>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="chat-empty-state">
                <div className="chat-empty-state__icon"><MessageOutlined /></div>
                <h2>{scenario.emptyTitle}</h2>
                <p>{scenario.emptyDescription}</p>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>
        </div>

        <footer className="chat-composer-area">
          <div className="chat-suggestions">
            {scenario.suggestedQuestions.map((question) => (
              <button key={question} type="button" onClick={() => sendQuestion(question)}>
                {question}
              </button>
            ))}
            {indexQuestions.map((question) => (
              <button key={question} type="button" onClick={() => sendQuestion(question)}>
                {question}
              </button>
            ))}
          </div>
          <div className={`chat-composer${isStreaming ? ' is-streaming' : ''}`}>
            <TextArea
              autoSize={{ minRows: 1, maxRows: 5 }}
              variant="borderless"
              value={input}
              placeholder={scenario.composerPlaceholder}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendQuestion();
                }
              }}
            />
            <div className="chat-composer__footer">
              <div>
                <Tooltip title="上传附件（原型）">
                  <Button type="text" icon={<PaperClipOutlined />} />
                </Tooltip>
                <span>答案仅基于已选知识库</span>
              </div>
              {isStreaming ? (
                <Button danger icon={<StopOutlined />} onClick={stopGeneration}>
                  停止
                </Button>
              ) : (
                <Button
                  type="primary"
                  shape="circle"
                  aria-label="发送问题"
                  icon={<SendOutlined />}
                  disabled={!input.trim() || !healthyLlm}
                  onClick={() => sendQuestion()}
                />
              )}
            </div>
          </div>
          <p className="chat-disclaimer">AI 生成内容可能存在偏差，请以引用原文和企业制度为准</p>
        </footer>
      </section>

      <aside className="citation-panel">
        <header className="citation-panel__header">
          <div>
            <span className="subtle-label">Answer evidence</span>
            <h2>原文引用</h2>
          </div>
          {activeCitation ? (
            <Tooltip title="关闭引用">
              <Button
                type="text"
                shape="circle"
                icon={<CloseOutlined />}
                onClick={() => setActiveCitation(null)}
              />
            </Tooltip>
          ) : null}
        </header>

        {activeCitation ? (
          <div className="citation-panel__body soft-scrollbar">
            <div className="citation-file-card">
              <span className="citation-file-card__icon"><FileTextOutlined /></span>
              <div>
                <strong>{activeCitation.source}</strong>
                <span>{activeCitation.fileType} · {activeCitation.locator}</span>
              </div>
              <Tag color="green">相关度 {(activeCitation.score * 100).toFixed(1)}%</Tag>
            </div>

            <div className="citation-preview">
              <div className="citation-preview__page">
                <div className="citation-preview__doc-title">{activeCitation.source}</div>
                <div className="citation-preview__doc-meta">
                  {activeCitation.fileType} · 内部资料
                </div>
                <Divider />
                <h3>{activeCitation.locator}</h3>
                <p>以下片段来自原文定位，供核对回答是否忠实于知识库。</p>
                <mark>{activeCitation.excerpt}</mark>
                <p>引用只展示命中的分块，不代表整份文件的全部内容。</p>
                <span className="citation-preview__page-number">{activeCitation.index}</span>
              </div>
            </div>

            <div className="citation-detail-card">
              <div>
                <span>知识库</span>
                <strong>
                  {knowledgeBases.find((item) => selectedKnowledgeBaseIds.includes(item.id))?.name ??
                    '当前知识库'}
                </strong>
              </div>
              <div>
                <span>分块编号</span>
                <strong>#chunk-003</strong>
              </div>
              <div>
                <span>检索路径</span>
                <strong>混合召回 → Rerank</strong>
              </div>
              <div>
                <span>引用位置</span>
                <strong>{activeCitation.locator}</strong>
              </div>
            </div>

            <div className="citation-score-card">
              <div>
                <strong>检索评分</strong>
                <span>最终重排得分</span>
              </div>
              <Progress
                percent={Math.round(activeCitation.score * 100)}
                strokeColor="#5B67F1"
                railColor="#ECEEFA"
                size="small"
              />
            </div>
          </div>
        ) : (
          <div className="citation-panel__empty">
            <div><DatabaseOutlined /></div>
            <h3>点击回答中的引用</h3>
            <p>这里会展示原文片段、页码、检索路径和相关度评分。</p>
          </div>
        )}
      </aside>
    </div>
  );
}


