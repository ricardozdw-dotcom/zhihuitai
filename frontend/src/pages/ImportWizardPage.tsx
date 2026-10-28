import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Progress,
  Result,
  Select,
  Slider,
  Space,
  Spin,
  Steps,
  Switch,
  Tag,
  Upload,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  BulbOutlined,
  CheckCircleFilled,
  CloudUploadOutlined,
  ColumnWidthOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  InboxOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  ScissorOutlined,
  TableOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getImportTask, uploadDocument } from '../api/client';
import { extractDocumentMetadata } from '../data/extract-metadata';
import {
  DEFAULT_CHUNK_SETTINGS,
  INDEX_SIZE_OPTIONS,
  estimateChunkCount,
  previewChunksFromText,
  readUploadText,
  resolveEffectiveChunkParams,
  type ChunkSettingsInput,
  type PreviewChunk,
} from '../data/chunk-preview';
import { usePrototype } from '../context/PrototypeContext';
import type { KnowledgeDocument } from '../types';
import './knowledge-pages.css';

type ChunkMethod =
  | 'smart'
  | 'heading'
  | 'delimiter'
  | 'fixed'
  | 'parent-child'
  | 'semantic'
  | 'qa'
  | 'page'
  | 'table-row';

interface ChunkMethodOption {
  id: ChunkMethod;
  label: string;
  description: string;
  icon: ReactNode;
  badge?: '推荐' | 'LLM';
}

interface ParserPreset {
  description: string;
  options: Array<{ value: string; label: string }>;
  supportsOcr: boolean;
}

const CHUNK_METHODS: ChunkMethodOption[] = [
  { id: 'smart', label: '智能分块', description: '自动识别文档结构并选择策略', icon: <ExperimentOutlined /> },
  {
    id: 'heading',
    label: '按标题层级',
    description: '手册、制度、规范等结构化文档',
    icon: <FileTextOutlined />,
    badge: '推荐',
  },
  { id: 'delimiter', label: '自定义分隔符', description: '格式规整的条款、清单', icon: <ScissorOutlined /> },
  { id: 'fixed', label: '固定长度', description: '无结构的长文本、转写稿', icon: <ColumnWidthOutlined /> },
  { id: 'parent-child', label: '父子分块', description: '长篇研报、技术文档', icon: <ApartmentOutlined /> },
  {
    id: 'semantic',
    label: '语义分块',
    description: '主题跳跃的长文、访谈纪要',
    icon: <BulbOutlined />,
    badge: 'LLM',
  },
  {
    id: 'qa',
    label: '问答对拆分',
    description: 'FAQ、客服、培训材料',
    icon: <QuestionCircleOutlined />,
    badge: 'LLM',
  },
  { id: 'page', label: '按页切分', description: '幻灯片、扫描件、图表多的报告', icon: <FilePdfOutlined /> },
  { id: 'table-row', label: '表格按行', description: '价目表、台账、产品清单', icon: <TableOutlined /> },
];

const PARSER_PRESETS: Record<ChunkMethod, ParserPreset> = {
  smart: {
    description: '自动检测文件格式、文本层与版面结构，必要时才调用 OCR。',
    options: [
      { value: 'auto', label: '智能解析（推荐）' },
      { value: 'native', label: '优先原生文本层' },
    ],
    supportsOcr: true,
  },
  heading: {
    description: '保留标题树和段落层级，标题会作为分块路径参与索引。',
    options: [
      { value: 'structure', label: '结构化解析（推荐）' },
      { value: 'native', label: '原生文本解析' },
    ],
    supportsOcr: true,
  },
  delimiter: {
    description: '先标准化换行与字符编码，再按指定分隔符切分正文。',
    options: [
      { value: 'plain', label: '纯文本解析' },
      { value: 'structure', label: '保留基础结构' },
    ],
    supportsOcr: true,
  },
  fixed: {
    description: '抽取连续正文并移除页眉页脚，按目标长度递归切分。',
    options: [
      { value: 'plain', label: '连续文本解析（推荐）' },
      { value: 'native', label: '原生文本解析' },
    ],
    supportsOcr: true,
  },
  'parent-child': {
    description: '先恢复章节结构，再生成用于召回的子块与用于回答的父块。',
    options: [
      { value: 'structure', label: '结构化解析（推荐）' },
      { value: 'native', label: '原生文本解析' },
    ],
    supportsOcr: true,
  },
  semantic: {
    description: '先抽取干净正文，再由模型识别主题边界并合并相邻语义。',
    options: [
      { value: 'semantic', label: '结构解析 + LLM 语义识别' },
      { value: 'native', label: '原生解析 + Embedding 聚类' },
    ],
    supportsOcr: true,
  },
  qa: {
    description: '识别已有问答结构；非问答材料可由模型生成问题并保留原文答案。',
    options: [
      { value: 'qa-detect', label: '问答结构识别（推荐）' },
      { value: 'qa-generate', label: 'LLM 生成问答对' },
    ],
    supportsOcr: true,
  },
  page: {
    description: '保留页码、版面区域和图片位置，扫描页自动调用版面 OCR。',
    options: [
      { value: 'layout', label: '版面解析 + 必要时 OCR' },
      { value: 'ocr', label: '全部页面 OCR' },
    ],
    supportsOcr: true,
  },
  'table-row': {
    description: '识别工作表、表头与合并单元格，每行继承表头后形成独立记录。',
    options: [
      { value: 'table', label: '表格结构化解析（推荐）' },
      { value: 'plain-table', label: '按 CSV 文本解析' },
    ],
    supportsOcr: false,
  },
};

const sampleFiles: UploadFile[] = [
  {
    uid: 'sample-docx',
    name: '产品手册_2026版.docx',
    status: 'done',
    size: 4_820_000,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    uid: 'sample-pdf',
    name: '部署与运维指南_图文版.pdf',
    status: 'done',
    size: 12_600_000,
    type: 'application/pdf',
  },
  {
    uid: 'sample-xlsx',
    name: '版本功能对照表.xlsx',
    status: 'done',
    size: 824_000,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
];

function apiSampleFiles(): UploadFile[] {
  const samples: Array<[string, string]> = [
    ['产品手册_2026版.md', '# 产品手册 2026版\n\n通用版本包含知识库、导入和带来源的问答。负责人：知识运营组。\n'],
    ['部署与运维指南_图文版.md', '# 私有化部署\n\n单组织建议从单机 Docker Compose 起步，向量使用 PostgreSQL 与 pgvector。\n'],
    ['版本功能对照表.md', '# 版本与报价\n\n标准版覆盖文件导入、分块预览和检索测试。\n'],
  ];
  return samples.map(([name, content], index) => {
    const file = new File([content], name, { type: 'text/markdown' });
    return {
      uid: `sample-api-${index}`,
      name,
      status: 'done',
      size: file.size,
      originFileObj: file as UploadFile['originFileObj'],
    };
  });
}

function humanFileSize(size?: number) {
  if (!size) return '—';
  return size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.round(size / 1000)} KB`;
}

const MOCK_PREVIEW_TEXT = `# 产品概述
通用版本包含知识库、导入流水线和带来源的问答能力。

## 导入流程
支持 Word、PDF、Markdown 与表格。解析后按参数设置完成分块与索引。

### 分块策略
系统可识别标题、条款、页面和表格结构。管理员也可以使用固定长度、父子分块或语义分块。

## 私有化部署
单组织建议从单机 Docker Compose 起步，向量使用 PostgreSQL 与 pgvector。

### 资源建议
默认 1024 维 Embedding。生产环境请按并发与语料规模评估内存。

## 版本与报价
标准版覆盖文件导入、分块预览和检索测试；企业版增加权限与审计。

---
附录：变更记录
2026-01 发布通用版
2026-03 增加 OCR 配额告警
`;

export function ImportWizardPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { id = 'kb-product' } = useParams();
  const { knowledgeBases, recordImport, ocrQuotaPages, apiEnabled, apiLoading, reloadWorkspace } =
    usePrototype();
  const knowledgeBase = knowledgeBases.find((item) => item.id === id);
  const committedRef = useRef(false);
  const [step, setStep] = useState(0);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedFileUid, setSelectedFileUid] = useState('');
  const [chunkMethod, setChunkMethod] = useState<ChunkMethod>('heading');
  const [parserMode, setParserMode] = useState('structure');
  const [chunkSettings, setChunkSettings] = useState<ChunkSettingsInput>({
    ...DEFAULT_CHUNK_SETTINGS,
    chunkSettingMode: 'custom',
    chunkSize: 600,
  });
  const [parentSize, setParentSize] = useState(1600);
  const [childSize, setChildSize] = useState(420);
  const [semanticThreshold, setSemanticThreshold] = useState(72);
  const [questionsPerChunk, setQuestionsPerChunk] = useState(3);
  const [pagesPerChunk, setPagesPerChunk] = useState(1);
  const [rowsPerChunk, setRowsPerChunk] = useState(1);
  const [preserveTableHeader, setPreserveTableHeader] = useState(true);
  const [enableOcr, setEnableOcr] = useState(true);
  const [enableImageOcr, setEnableImageOcr] = useState(true);
  const [indexMode, setIndexMode] = useState<'hybrid' | 'vector' | 'fulltext'>('hybrid');
  const [indexPrefixTitle, setIndexPrefixTitle] = useState(true);
  const [indexKeywords, setIndexKeywords] = useState(false);
  const [indexQuestions, setIndexQuestions] = useState(false);
  const [indexSummary, setIndexSummary] = useState(false);
  const [previewByUid, setPreviewByUid] = useState<
    Record<string, { chunks: PreviewChunk[]; error?: string; loading?: boolean }>
  >({});
  const [isIndexing, setIsIndexing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  const selectedMethod = CHUNK_METHODS.find((item) => item.id === chunkMethod) ?? CHUNK_METHODS[0];
  const parserPreset = PARSER_PRESETS[chunkMethod];
  const previewSettings = useMemo<ChunkSettingsInput>(() => {
    const base: ChunkSettingsInput = {
      ...chunkSettings,
      chunkSettingMode: 'custom',
      indexPrefixTitle,
    };
    switch (chunkMethod) {
      case 'smart':
        return { ...base, chunkSettingMode: 'auto' };
      case 'heading':
      case 'semantic':
      case 'qa':
        return { ...base, chunkSplitMode: 'paragraph' };
      case 'delimiter':
        return { ...base, chunkSplitMode: 'char' };
      case 'fixed':
        return { ...base, chunkSplitMode: 'size' };
      case 'parent-child':
        return {
          ...base,
          chunkSplitMode: 'size',
          chunkSize: childSize,
          overlap: Math.min(100, Math.round(childSize * 0.15)),
        };
      case 'page':
        return { ...base, chunkSplitMode: 'char', chunkSplitter: '\\f', chunkSize: pagesPerChunk * 1200 };
      case 'table-row':
        return { ...base, chunkSplitMode: 'char', chunkSplitter: '\\n', chunkSize: rowsPerChunk * 420 };
    }
  }, [childSize, chunkMethod, chunkSettings, indexPrefixTitle, pagesPerChunk, rowsPerChunk]);
  const effectiveChunk = useMemo(() => resolveEffectiveChunkParams(previewSettings), [previewSettings]);
  const selectedFile = useMemo(
    () => fileList.find((file) => file.uid === selectedFileUid) ?? fileList[0],
    [fileList, selectedFileUid],
  );
  const selectedPreview = selectedFile ? previewByUid[selectedFile.uid] : undefined;
  const previewChunks = selectedPreview?.chunks ?? [];
  const estimatedChunks = useMemo(() => {
    const previewTotal = Object.values(previewByUid).reduce(
      (sum, item) => sum + (item.chunks?.length ?? 0),
      0,
    );
    if (previewTotal > 0) return previewTotal;
    const chars = fileList.reduce((sum, file) => {
      const name = file.name.toLowerCase();
      return sum + (/\.(md|txt|csv|markdown)$/.test(name) ? (file.size ?? 0) : Math.round((file.size ?? 40_000) * 0.04));
    }, 0);
    return estimateChunkCount(chars, effectiveChunk.chunkSize, fileList.length);
  }, [effectiveChunk.chunkSize, fileList, previewByUid]);
  const activeEnhancements = useMemo(() => {
    const labels: string[] = [];
    if (indexPrefixTitle) labels.push('标题前缀');
    if (indexKeywords) labels.push('关键词增强');
    if (indexQuestions) labels.push('问题索引');
    if (indexSummary) labels.push('摘要索引');
    return labels;
  }, [indexKeywords, indexPrefixTitle, indexQuestions, indexSummary]);

  useEffect(() => {
    if (!isIndexing || apiEnabled) return undefined;
    const timer = window.setInterval(() => setProgress((current) => Math.min(current + 8, 100)), 120);
    return () => window.clearInterval(timer);
  }, [apiEnabled, isIndexing]);

  useEffect(() => {
    if (apiEnabled || !isIndexing || progress < 100 || committedRef.current || !knowledgeBase) return;
    committedRef.current = true;
    setIsIndexing(false);
    setIsComplete(true);
    const chunksPerFile = Math.max(1, Math.round(estimatedChunks / Math.max(fileList.length, 1)));
    const documents: KnowledgeDocument[] = fileList.map((file) => {
      const format = file.name.split('.').pop()?.toUpperCase() ?? 'FILE';
      return {
        id: `doc-${file.uid}-${knowledgeBase.id}`,
        name: file.name,
        format,
        size: humanFileSize(file.size),
        status: 'ready' as const,
        chunks: chunksPerFile,
        parser: selectedMethod.label,
        updatedAt: '刚刚',
        metadata: extractDocumentMetadata({
          fileName: file.name,
          format,
          knowledgeBaseName: knowledgeBase.name,
          owner: knowledgeBase.owner,
        }),
      };
    });
    recordImport(
      knowledgeBase.id,
      documents,
      documents.map((document) => ({
        id: `task-${document.id}`,
        knowledgeBaseId: knowledgeBase.id,
        knowledgeBase: knowledgeBase.name,
        fileName: document.name,
        stage: '完成',
        status: 'success' as const,
        progress: 100,
        updatedAt: '刚刚',
      })),
    );
  }, [apiEnabled, estimatedChunks, fileList, isIndexing, knowledgeBase, progress, recordImport, selectedMethod.label]);

  useEffect(() => {
    if (step !== 1 || fileList.length === 0) return;
    let cancelled = false;
    const run = async () => {
      for (const file of fileList) {
        const origin = file.originFileObj as File | undefined;
        if (!origin) {
          if (apiEnabled) {
            setPreviewByUid((current) => ({
              ...current,
              [file.uid]: { chunks: [], error: '没有可读的本地文件内容，无法预览真实分块' },
            }));
            continue;
          }
          const chunks = previewChunksFromText(MOCK_PREVIEW_TEXT, file.name, effectiveChunk).map(
            (chunk, index) => ({ ...chunk, id: `${file.uid}-${index + 1}` }),
          );
          setPreviewByUid((current) => ({ ...current, [file.uid]: { chunks } }));
          continue;
        }
        setPreviewByUid((current) => ({
          ...current,
          [file.uid]: { chunks: current[file.uid]?.chunks ?? [], loading: true },
        }));
        try {
          const raw = await readUploadText(origin);
          if (cancelled) return;
          const chunks = previewChunksFromText(raw, file.name, effectiveChunk);
          setPreviewByUid((current) => ({ ...current, [file.uid]: { chunks, loading: false } }));
        } catch (error) {
          if (cancelled) return;
          setPreviewByUid((current) => ({
            ...current,
            [file.uid]: {
              chunks: [],
              loading: false,
              error: error instanceof Error ? error.message : '预览失败',
            },
          }));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiEnabled, effectiveChunk, fileList, step]);

  if (!knowledgeBase) {
    if (apiEnabled && apiLoading) {
      return <div className="app-page" style={{ padding: '80px 0', textAlign: 'center' }}><Spin /></div>;
    }
    return (
      <div className="app-page">
        <Result
          status="404"
          title="未找到知识库"
          extra={<Button type="primary" onClick={() => navigate('/knowledge')}>返回知识库列表</Button>}
        />
      </div>
    );
  }

  const uploadProps: UploadProps = {
    multiple: true,
    fileList,
    beforeUpload: () => false,
    accept: '.doc,.docx,.pdf,.md,.zip,.png,.jpg,.jpeg,.webp,.tiff,.xls,.xlsx,.csv,.tsv',
    onChange: ({ fileList: nextFileList }) => {
      setFileList(nextFileList);
      if (nextFileList.length > 0 && !nextFileList.some((file) => file.uid === selectedFileUid)) {
        setSelectedFileUid(nextFileList[0].uid);
      }
    },
  };

  const loadSampleFiles = () => {
    const nextFiles = apiEnabled ? apiSampleFiles() : sampleFiles;
    setFileList(nextFiles);
    setSelectedFileUid(nextFiles[0].uid);
    void message.success(apiEnabled ? '已载入 3 个可上传的示例 Markdown' : '已载入 3 个示例文件');
  };
  const chooseChunkMethod = (method: ChunkMethod) => {
    setChunkMethod(method);
    setParserMode(PARSER_PRESETS[method].options[0].value);
    if (method === 'qa') setIndexQuestions(true);
    if (method === 'semantic') setIndexKeywords(true);
  };
  const goNext = () => {
    if (step === 0 && fileList.length === 0) {
      void message.warning('请先选择文件，或载入示例文件');
      return;
    }
    setStep((current) => Math.min(current + 1, 2));
  };
  const startImport = () => {
    if (apiEnabled) {
      void runApiImport();
      return;
    }
    setProgress(8);
    setIsIndexing(true);
  };
  const runApiImport = async () => {
    setProgress(8);
    setIsIndexing(true);
    try {
      const total = fileList.length || 1;
      for (const [index, file] of fileList.entries()) {
        const raw = file.originFileObj;
        if (!raw) throw new Error(`「${file.name}」没有文件内容。API 模式下请上传真实文件。`);
        const metadata = extractDocumentMetadata({
          fileName: file.name,
          format: file.name.split('.').pop(),
          knowledgeBaseName: knowledgeBase.name,
          owner: knowledgeBase.owner,
        });
        const result = await uploadDocument(knowledgeBase.id, raw, metadata);
        let task = result.task;
        for (let attempt = 0; task.status === 'processing' && attempt < 40; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          task = await getImportTask(task.id);
        }
        if (task.status !== 'success') throw new Error(task.error || `「${file.name}」导入失败`);
        setProgress(Math.round(((index + 1) / total) * 100));
      }
      await reloadWorkspace();
      setIsComplete(true);
      void message.success('文件已写入后端并完成索引');
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setIsIndexing(false);
    }
  };

  const methodConfiguration = (() => {
    switch (chunkMethod) {
      case 'smart':
        return (
          <Alert
            type="success"
            showIcon
            message="已检测到 4 个章节标题、8 个条款，建议按标题层级切分"
            description="智能模式会逐文件判断结构；表格和扫描页会自动切换到对应解析器。"
          />
        );
      case 'heading':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control">
              <span>最大标题层级</span>
              <InputNumber min={1} max={6} value={chunkSettings.headingDepth} onChange={(value) => setChunkSettings((current) => ({ ...current, headingDepth: Number(value ?? 4) }))} />
              <small>超过该层级的标题并入正文</small>
            </label>
            <label className="wizard-control">
              <span>最小分块长度</span>
              <InputNumber min={0} max={2000} addonAfter="字符" value={chunkSettings.minChunkSize} onChange={(value) => setChunkSettings((current) => ({ ...current, minChunkSize: Number(value ?? 0) }))} />
              <small>过短章节会与相邻内容合并</small>
            </label>
            <label className="wizard-control">
              <span>超长章节上限</span>
              <InputNumber min={128} max={4000} addonAfter="字符" value={chunkSettings.chunkSize} onChange={(value) => setChunkSettings((current) => ({ ...current, chunkSize: Number(value ?? 600) }))} />
              <small>超过上限后在句子边界二次切分</small>
            </label>
          </div>
        );
      case 'delimiter':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control wizard-control--wide">
              <span>分隔符</span>
              <Input value={chunkSettings.chunkSplitter} placeholder="例如：\\n\\n、---、###" onChange={(event) => setChunkSettings((current) => ({ ...current, chunkSplitter: event.target.value }))} />
              <small>支持 \n、\t 等转义字符；留空时按全文处理</small>
            </label>
            <label className="wizard-control">
              <span>超长片段上限</span>
              <InputNumber min={128} max={4000} addonAfter="字符" value={chunkSettings.chunkSize} onChange={(value) => setChunkSettings((current) => ({ ...current, chunkSize: Number(value ?? 600) }))} />
            </label>
          </div>
        );
      case 'fixed':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control">
              <span>目标长度</span>
              <InputNumber min={128} max={4000} addonAfter="字符" value={chunkSettings.chunkSize} onChange={(value) => setChunkSettings((current) => ({ ...current, chunkSize: Number(value ?? 600) }))} />
            </label>
            <label className="wizard-control">
              <span>重叠长度</span>
              <InputNumber min={0} max={400} addonAfter="字符" value={chunkSettings.overlap} onChange={(value) => setChunkSettings((current) => ({ ...current, overlap: Number(value ?? 0) }))} />
            </label>
          </div>
        );
      case 'parent-child':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control">
              <span>父块长度</span>
              <InputNumber min={800} max={6000} addonAfter="字符" value={parentSize} onChange={(value) => setParentSize(Number(value ?? 1600))} />
              <small>命中子块后向模型返回完整父块</small>
            </label>
            <label className="wizard-control">
              <span>子块长度</span>
              <InputNumber min={128} max={1200} addonAfter="字符" value={childSize} onChange={(value) => setChildSize(Number(value ?? 420))} />
              <small>子块用于向量召回</small>
            </label>
          </div>
        );
      case 'semantic':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control wizard-control--wide">
              <span>语义相似度阈值 · {semanticThreshold}%</span>
              <Slider min={40} max={95} value={semanticThreshold} onChange={setSemanticThreshold} />
              <small>阈值越高，主题变化时越容易生成新分块</small>
            </label>
            <label className="wizard-control">
              <span>最大分块长度</span>
              <InputNumber min={256} max={4000} addonAfter="字符" value={chunkSettings.chunkSize} onChange={(value) => setChunkSettings((current) => ({ ...current, chunkSize: Number(value ?? 800) }))} />
            </label>
          </div>
        );
      case 'qa':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control">
              <span>每个原文块生成问题</span>
              <InputNumber min={1} max={8} addonAfter="个" value={questionsPerChunk} onChange={(value) => setQuestionsPerChunk(Number(value ?? 3))} />
            </label>
            <label className="wizard-control">
              <span>生成模型</span>
              <Select value="qwen-plus" options={[{ value: 'qwen-plus', label: 'qwen-plus · 通义百炼' }]} />
            </label>
          </div>
        );
      case 'page':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control">
              <span>每个分块合并页数</span>
              <InputNumber min={1} max={5} addonAfter="页" value={pagesPerChunk} onChange={(value) => setPagesPerChunk(Number(value ?? 1))} />
              <small>页码和版面坐标会保留在引用中</small>
            </label>
          </div>
        );
      case 'table-row':
        return (
          <div className="wizard-control-grid">
            <label className="wizard-control">
              <span>每个分块包含行数</span>
              <InputNumber min={1} max={20} addonAfter="行" value={rowsPerChunk} onChange={(value) => setRowsPerChunk(Number(value ?? 1))} />
            </label>
            <label className="wizard-control wizard-control--switch">
              <span>每行继承表头</span>
              <Switch checked={preserveTableHeader} onChange={setPreserveTableHeader} />
              <small>将列名拼接到每行索引文本中</small>
            </label>
          </div>
        );
    }
  })();

  const stepUpload = (
    <div className="wizard-panel wizard-files">
      <Upload.Dragger {...uploadProps} className="wizard-dragger">
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">点击或拖拽文件到这里</p>
        <p className="ant-upload-hint">支持 Word、PDF、Markdown/ZIP、图片和表格；单个文件不超过 500 MB</p>
      </Upload.Dragger>
      <div className="wizard-sample-action">
        <span>没有测试文件？使用内置样例快速体验完整流程。</span>
        <Button onClick={loadSampleFiles}>载入示例文件</Button>
      </div>
      <Alert type="info" showIcon message="Markdown 中的相对图片请与 .md 文件一起打包为 ZIP；密码保护和破损文件会给出明确错误。" />
    </div>
  );

  const stepConfigure = (
    <div className="wizard-panel wizard-config-preview">
      <div className="wizard-config-column">
        <section className="wizard-config-section">
          <header className="wizard-config-section__header">
            <div>
              <span className="wizard-section-index">1</span>
              <div><h3>选择分块方式</h3><p>先决定知识如何被拆分，再配置对应解析方式。</p></div>
            </div>
            <span className="wizard-recommendation">推荐：按标题层级（检测到 4 个章节标题、8 个条款）</span>
          </header>
          <div className="wizard-method-grid">
            {CHUNK_METHODS.map((method) => (
              <button
                key={method.id}
                type="button"
                aria-pressed={chunkMethod === method.id}
                className={`wizard-method-card${chunkMethod === method.id ? ' is-selected' : ''}`}
                onClick={() => chooseChunkMethod(method.id)}
              >
                <span className="wizard-method-card__icon">{method.icon}</span>
                <span className="wizard-method-card__copy">
                  <strong>
                    {method.label}
                    {method.badge ? <Tag color={method.badge === '推荐' ? 'green' : 'purple'}>{method.badge}</Tag> : null}
                  </strong>
                  <small>{method.description}</small>
                </span>
                <span className="wizard-method-card__check"><CheckCircleFilled /></span>
              </button>
            ))}
          </div>
        </section>

        <section className="wizard-config-section">
          <header className="wizard-config-section__header">
            <div>
              <span className="wizard-section-index">2</span>
              <div><h3>解析与分块配置</h3><p>当前配置仅针对“{selectedMethod.label}”，切换方式后自动匹配。</p></div>
            </div>
          </header>
          <div className="wizard-parser-profile">
            <span className="wizard-parser-profile__icon"><RobotOutlined /></span>
            <div><strong>解析方式</strong><p>{parserPreset.description}</p></div>
            <Select value={parserMode} options={parserPreset.options} onChange={setParserMode} />
          </div>
          <div className="wizard-method-config">{methodConfiguration}</div>
          {parserPreset.supportsOcr ? (
            <div className="wizard-parser-options">
              <label>
                <Switch checked={enableOcr} onChange={setEnableOcr} />
                <span><strong>扫描页 OCR</strong><small>仅文本层缺失时调用云端 API</small></span>
              </label>
              <label>
                <Switch checked={enableImageOcr} onChange={setEnableImageOcr} />
                <span><strong>内嵌图片 OCR</strong><small>识别图片中的文字并关联原位置</small></span>
              </label>
            </div>
          ) : null}
          {ocrQuotaPages < 40 && parserPreset.supportsOcr ? (
            <Alert type="warning" showIcon message={`阿里云 OCR 本月剩余 ${ocrQuotaPages} 页，扫描件入库前请补充额度。`} />
          ) : null}
        </section>

        <section className="wizard-config-section">
          <header className="wizard-config-section__header">
            <div>
              <span className="wizard-section-index">3</span>
              <div><h3>索引增强</h3><p>决定分块以什么形式进入检索索引，不改变原始文档内容。</p></div>
            </div>
          </header>
          <label className="wizard-index-mode">
            <span><DatabaseOutlined /> 索引方式</span>
            <Select
              value={indexMode}
              onChange={setIndexMode}
              options={[
                { value: 'hybrid', label: '向量 + 全文混合索引（推荐）' },
                { value: 'vector', label: '仅向量索引' },
                { value: 'fulltext', label: '仅全文索引' },
              ]}
            />
          </label>
          <div className="wizard-index-grid">
            <label>
              <Checkbox checked={indexPrefixTitle} onChange={(event) => setIndexPrefixTitle(event.target.checked)} />
              <span><strong>标题写入索引</strong><small>保留章节路径，提升语境完整性</small></span>
            </label>
            <label>
              <Checkbox checked={indexKeywords} onChange={(event) => setIndexKeywords(event.target.checked)} />
              <span><strong>关键词增强 <Tag color="purple">LLM</Tag></strong><small>为每个分块生成检索关键词</small></span>
            </label>
            <label>
              <Checkbox checked={indexQuestions} onChange={(event) => setIndexQuestions(event.target.checked)} />
              <span><strong>问题索引 <Tag color="purple">LLM</Tag></strong><small>生成用户可能提问的问题表达</small></span>
            </label>
            <label>
              <Checkbox checked={indexSummary} onChange={(event) => setIndexSummary(event.target.checked)} />
              <span><strong>摘要索引 <Tag color="purple">LLM</Tag></strong><small>为长分块补充短摘要用于召回</small></span>
            </label>
          </div>
          <label className="wizard-index-size">
            <span>单条索引文本上限</span>
            <Select
              value={chunkSettings.indexSize}
              options={INDEX_SIZE_OPTIONS.map((value) => ({ value, label: `${value} tokens` }))}
              onChange={(value) => setChunkSettings((current) => ({ ...current, indexSize: value }))}
            />
          </label>
        </section>
      </div>

      <aside className="wizard-live-preview">
        <header>
          <div><span className="subtle-label">Live preview</span><h3>实时分块预览</h3></div>
          <Tag color="blue">{selectedMethod.label}</Tag>
        </header>
        <div className="wizard-preview-toolbar">
          <Select
            value={selectedFile?.uid}
            placeholder="选择预览文件"
            options={fileList.map((file) => ({ value: file.uid, label: file.name }))}
            onChange={setSelectedFileUid}
          />
          <div><span>当前文件</span><strong>{previewChunks.length} 块</strong></div>
          <div><span>全部预计</span><strong>约 {estimatedChunks} 块</strong></div>
        </div>
        <Alert type="info" showIcon message="修改左侧配置后，预览会自动重新计算；当前为前端原型效果。" />
        <div className="wizard-live-preview__list">
          {selectedPreview?.loading ? (
            <Spin description="正在重新生成预览"><div className="wizard-preview-loading" /></Spin>
          ) : selectedPreview?.error ? (
            <Alert type="warning" showIcon message={selectedPreview.error} />
          ) : (
            previewChunks.slice(0, 10).map((chunk, index) => (
              <article key={chunk.id}>
                <header>
                  <span>#{index + 1}</span>
                  <strong>{chunkMethod === 'qa' ? `问题：${chunk.title}` : chunk.title}</strong>
                  <small>{chunk.tokens} tokens</small>
                </header>
                {chunkMethod === 'parent-child' ? (
                  <div className="wizard-parent-path">
                    <Tag color="geekblue">父块 {Math.floor(index / 3) + 1}</Tag>
                    <span>子块命中后返回约 {parentSize} 字符上下文</span>
                  </div>
                ) : null}
                <p>
                  {chunkMethod === 'table-row' && preserveTableHeader ? '表头：字段 / 版本 / 说明\n' : ''}
                  {chunkMethod === 'qa' ? `答案：${chunk.content}` : chunk.content}
                </p>
                <footer>
                  <span>{chunkMethod === 'page' ? `第 ${index + 1} 页` : chunk.locator}</span>
                  <span>{activeEnhancements.length ? activeEnhancements.join(' · ') : '原文索引'}</span>
                </footer>
              </article>
            ))
          )}
          {!selectedPreview?.loading && !selectedPreview?.error && previewChunks.length === 0 ? (
            <Alert type="info" showIcon message="没有生成分块，请确认文件是否有可读正文。" />
          ) : null}
          {previewChunks.length > 10 ? <Alert type="info" showIcon message={`仅展示前 10 块，共 ${previewChunks.length} 块。`} /> : null}
        </div>
      </aside>
    </div>
  );

  const stepConfirm = isComplete ? (
    <Result
      status="success"
      title="文件已提交并完成索引"
      subTitle={`${fileList.length} 个文件已进入「${knowledgeBase.name}」。文档信息与业务标注可在文件列表中继续编辑。`}
      extra={[
        <Button key="detail" type="primary" onClick={() => navigate(`/knowledge/${knowledgeBase.id}`)}>返回知识库并编辑文档</Button>,
        <Button key="chat" onClick={() => navigate('/chat')}>在线对话测试</Button>,
      ]}
    />
  ) : (
    <div className="wizard-panel wizard-confirm">
      <Card bordered={false} className="wizard-confirm__summary">
        <span className="wizard-confirm__icon"><CloudUploadOutlined /></span>
        <div>
          <span className="subtle-label">Ready to index</span>
          <h3>确认将 {fileList.length} 个文件导入知识库</h3>
          <p>文件会在后台完成解析、分块和索引构建；文档业务标注在导入后单独维护。</p>
        </div>
      </Card>
      <div className="wizard-confirm__grid">
        <div><span>目标知识库</span><strong>{knowledgeBase.name}</strong></div>
        <div><span>分块方式</span><strong>{selectedMethod.label}</strong></div>
        <div><span>解析方式</span><strong>{parserPreset.options.find((item) => item.value === parserMode)?.label}</strong></div>
        <div><span>预计分块</span><strong>约 {estimatedChunks} 个</strong></div>
        <div><span>索引方式</span><strong>{indexMode === 'hybrid' ? '向量 + 全文混合索引' : indexMode === 'vector' ? '向量索引' : '全文索引'}</strong></div>
        <div><span>索引增强</span><strong>{activeEnhancements.length ? activeEnhancements.join('、') : '未启用'}</strong></div>
      </div>
      <Alert
        type="info"
        showIcon
        icon={<TagsOutlined />}
        message="元数据不再占用导入步骤。入库后可在具体文档的“编辑文档信息与标注”中维护负责人、版本、关键词和常见问题。"
      />
      {isIndexing ? (
        <div className="wizard-indexing">
          <Progress percent={progress} strokeColor="#5B67F1" />
          <span>{progress < 30 ? '正在解析文件…' : progress < 55 ? '正在执行 OCR 与内容标准化…' : progress < 82 ? '正在生成 Embedding…' : '正在写入索引…'}</span>
        </div>
      ) : (
        <Alert type="warning" showIcon message="开始后可离开当前页面，任务会在后台继续执行；失败阶段支持单独重试。" />
      )}
    </div>
  );

  const panels = [stepUpload, stepConfigure, stepConfirm];
  return (
    <div className="app-page import-wizard-page">
      <div className="import-wizard-header">
        <button type="button" onClick={() => navigate(`/knowledge/${knowledgeBase.id}`)}><ArrowLeftOutlined /> 退出导入</button>
        <div><span className="subtle-label">Import knowledge</span><h1>导入到「{knowledgeBase.name}」</h1></div>
      </div>
      <Card className="surface-card import-wizard-card" bordered={false}>
        <Steps
          current={step}
          items={[
            { title: '上传文档', description: '选择文件' },
            { title: '解析、分块与索引', description: '配置并实时预览' },
            { title: '确认导入', description: '构建索引' },
          ]}
        />
        <div className="import-wizard-content">{panels[step]}</div>
        {!isComplete ? (
          <footer className="import-wizard-footer">
            <Button disabled={step === 0 || isIndexing} onClick={() => setStep((current) => current - 1)}>上一步</Button>
            <Space>
              {step < 2 ? (
                <Button type="primary" onClick={goNext}>下一步</Button>
              ) : (
                <Button type="primary" icon={<CloudUploadOutlined />} loading={isIndexing} onClick={startImport}>
                  {isIndexing ? '正在构建索引' : '确认并开始入库'}
                </Button>
              )}
            </Space>
          </footer>
        ) : null}
      </Card>
    </div>
  );
}
