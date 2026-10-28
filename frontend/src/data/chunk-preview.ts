/** 本地分块预览：对齐 FastGPT 式「直接分段」的自动 / 自定义参数。 */
export interface PreviewChunk {
  id: string;
  title: string;
  content: string;
  locator: string;
  tokens: number;
}

export type ChunkSettingMode = 'auto' | 'custom';
export type ChunkSplitMode = 'paragraph' | 'size' | 'char';

export interface ChunkSettingsInput {
  chunkSettingMode: ChunkSettingMode;
  chunkSplitMode: ChunkSplitMode;
  chunkSize: number;
  indexSize: number;
  overlap: number;
  headingDepth: number;
  minChunkSize: number;
  chunkSplitter: string;
  indexPrefixTitle: boolean;
}

export interface EffectiveChunkParams {
  chunkSplitMode: ChunkSplitMode;
  chunkSize: number;
  chunkOverlap: number;
  headingDepth: number;
  minChunkSize: number;
  chunkSplitter: string;
  indexSize: number;
  indexPrefixTitle: boolean;
}

export const DEFAULT_CHUNK_SETTINGS: ChunkSettingsInput = {
  chunkSettingMode: 'auto',
  chunkSplitMode: 'paragraph',
  chunkSize: 1000,
  indexSize: 512,
  overlap: 120,
  headingDepth: 5,
  minChunkSize: 100,
  chunkSplitter: '',
  indexPrefixTitle: true,
};

export const INDEX_SIZE_OPTIONS = [256, 512, 768, 1024] as const;

const SIZE_SEPARATORS = ['\n\n', '\n', '。', '；', '，', ' ', ''];

export function resolveEffectiveChunkParams(settings: ChunkSettingsInput): EffectiveChunkParams {
  if (settings.chunkSettingMode === 'auto') {
    return {
      chunkSplitMode: 'paragraph',
      headingDepth: 5,
      minChunkSize: 100,
      chunkSize: 1000,
      indexSize: 512,
      chunkOverlap: 0,
      chunkSplitter: '',
      indexPrefixTitle: settings.indexPrefixTitle,
    };
  }
  const chunkSize = Math.min(4000, Math.max(64, Number(settings.chunkSize) || 1000));
  const overlap = Math.min(400, Math.max(0, Number(settings.overlap) || 0));
  return {
    chunkSplitMode: settings.chunkSplitMode,
    headingDepth: Math.min(6, Math.max(0, Number(settings.headingDepth) || 0)),
    minChunkSize: Math.max(0, Number(settings.minChunkSize) || 0),
    chunkSize,
    indexSize: settings.indexSize || 512,
    chunkOverlap: settings.chunkSplitMode === 'size' ? overlap : 0,
    chunkSplitter: settings.chunkSplitter ?? '',
    indexPrefixTitle: settings.indexPrefixTitle,
  };
}

export function estimateChunkCount(totalChars: number, chunkSize: number, fileCount: number): number {
  if (fileCount <= 0) return 0;
  const size = Math.max(chunkSize, 1);
  if (totalChars > 0) {
    return Math.max(fileCount, Math.round(totalChars / (size * 0.85)));
  }
  // 无正文可读时按体积启发式（约每文件 40KB 文本当量）
  return Math.max(fileCount, Math.round((fileCount * 40_000) / size));
}

function splitOnce(text: string, separator: string): string[] {
  if (!separator) return Array.from(text);
  if (!text.includes(separator)) return [text];
  return text.split(separator);
}

function mergeSplits(splits: string[], separator: string, chunkSize: number, chunkOverlap: number): string[] {
  const docs: string[] = [];
  const current: string[] = [];
  let total = 0;
  const sepLen = separator.length;
  const join = (parts: string[]) => parts.join(separator).trim();

  for (const split of splits) {
    const len = split.length;
    if (total + len + (current.length ? sepLen : 0) > chunkSize) {
      if (current.length) {
        const doc = join(current);
        if (doc) docs.push(doc);
        while (total > chunkOverlap && current.length) {
          total -= current[0].length + (current.length > 1 ? sepLen : 0);
          current.shift();
        }
      }
    }
    current.push(split);
    total += len + (current.length > 1 ? sepLen : 0);
  }
  const doc = join(current);
  if (doc) docs.push(doc);
  return docs;
}

function recursiveSplit(text: string, separators: string[], chunkSize: number, chunkOverlap: number): string[] {
  const sep = separators[0] ?? '';
  const rest = separators.slice(1);
  const raw = splitOnce(text, sep);
  const good: string[] = [];
  const pending: string[] = [];

  const flushPending = () => {
    if (!pending.length) return;
    good.push(...mergeSplits(pending, sep, chunkSize, chunkOverlap));
    pending.length = 0;
  };

  for (const part of raw) {
    if (part.length < chunkSize) {
      pending.push(part);
      continue;
    }
    flushPending();
    if (rest.length) {
      good.push(...recursiveSplit(part, rest, chunkSize, chunkOverlap));
    } else {
      const step = Math.max(1, chunkSize - chunkOverlap);
      for (let i = 0; i < part.length; i += step) {
        const slice = part.slice(i, i + chunkSize).trim();
        if (slice) good.push(slice);
      }
    }
  }
  flushPending();
  return good;
}

interface TextSection {
  title: string;
  body: string;
}

function splitByParagraphs(text: string, headingDepth: number): TextSection[] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (headingDepth <= 0) {
    return normalized
      .split(/\n{2,}/)
      .map((body) => body.trim())
      .filter(Boolean)
      .map((body) => ({ title: '', body }));
  }

  const lines = normalized.split('\n');
  const sections: TextSection[] = [];
  let current: TextSection = { title: '', body: '' };

  const pushCurrent = () => {
    if (current.title || current.body.trim()) {
      sections.push({ title: current.title, body: current.body.replace(/^\n+/, '').trimEnd() });
    }
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match && match[1].length <= headingDepth) {
      pushCurrent();
      current = { title: match[2].trim(), body: '' };
      continue;
    }
    current.body += (current.body ? '\n' : '') + line;
  }
  pushCurrent();
  return sections.length ? sections : [{ title: '', body: normalized.trim() }];
}

function sectionToText(section: TextSection): string {
  if (section.title && !section.body.startsWith('#')) {
    return `# ${section.title}\n${section.body}`.trim();
  }
  if (section.title && !section.body.includes(section.title)) {
    return `${section.title}\n${section.body}`.trim();
  }
  return (section.body || section.title).trim();
}

function mergeSmallSections(sections: TextSection[], minChunkSize: number, chunkSize: number): TextSection[] {
  if (!sections.length) return [];
  const merged: TextSection[] = [];
  let buffer: TextSection | null = null;

  for (const section of sections) {
    const text = sectionToText(section);
    if (!buffer) {
      buffer = { title: section.title, body: text };
      continue;
    }
    const bufLen = buffer.body.length;
    const canMergeSmall = bufLen < minChunkSize;
    const fitsTogether = bufLen + text.length + 2 <= chunkSize;
    if (canMergeSmall && (fitsTogether || bufLen + text.length < minChunkSize * 2)) {
      buffer = {
        title: buffer.title || section.title,
        body: `${buffer.body}\n\n${text}`.trim(),
      };
    } else {
      merged.push(buffer);
      buffer = { title: section.title, body: text };
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
}

function splitOversized(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (text.length <= chunkSize) return text.trim() ? [text.trim()] : [];
  return recursiveSplit(text, SIZE_SEPARATORS, chunkSize, chunkOverlap);
}

function unescapeSplitter(splitter: string): string {
  return splitter
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
}

function splitByCustomSeparator(text: string, splitter: string, chunkSize: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const resolved = unescapeSplitter(splitter);
  const parts = resolved ? normalized.split(resolved) : [normalized];
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length <= chunkSize) {
      out.push(trimmed);
    } else {
      out.push(...splitOversized(trimmed, chunkSize, 0));
    }
  }
  return out;
}

function splitParagraphMode(
  text: string,
  headingDepth: number,
  minChunkSize: number,
  chunkSize: number,
): { title: string; content: string }[] {
  const sections = mergeSmallSections(splitByParagraphs(text, headingDepth), minChunkSize, chunkSize);
  const out: { title: string; content: string }[] = [];
  for (const section of sections) {
    const content = section.body.trim();
    if (!content) continue;
    if (content.length <= chunkSize) {
      out.push({ title: section.title, content });
      continue;
    }
    const pieces = splitOversized(content, chunkSize, 0);
    pieces.forEach((piece, index) => {
      out.push({
        title: index === 0 ? section.title : `${section.title || '片段'} · ${index + 1}`,
        content: piece,
      });
    });
  }
  return out;
}

function toPreviewChunks(
  parts: { title: string; content: string }[],
  fileName: string,
  fullText: string,
  indexPrefixTitle: boolean,
): PreviewChunk[] {
  const chunks: PreviewChunk[] = [];
  let page = 1;
  parts.forEach((part, index) => {
    const pageMatch = part.content.match(/\f(\d+)/);
    if (pageMatch) page = Number(pageMatch[1]);
    let body = part.content.replace(/\f\d+\n?/g, '').trim();
    if (!body) return;
    let title = part.title.replace(/^#+\s*/, '').trim();
    if (!title) {
      const firstLine = body
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      title = (firstLine ?? body).replace(/^#+\s*/, '').trim().slice(0, 40);
    } else {
      title = title.slice(0, 40);
    }
    if (indexPrefixTitle && title && !body.startsWith(title) && !body.startsWith(`# ${title}`)) {
      body = `${title}\n${body}`;
    }
    const locator = fullText.includes('\f') ? `第 ${page} 页 · 片段 ${index + 1}` : `片段 ${index + 1}`;
    chunks.push({
      id: `${fileName}-${index + 1}`,
      title,
      content: body,
      locator,
      tokens: Math.max(1, Math.floor(body.length / 2)),
    });
  });
  return chunks;
}

export function previewChunksFromText(
  text: string,
  fileName: string,
  options?: Partial<EffectiveChunkParams> | { chunkSize?: number; chunkOverlap?: number },
): PreviewChunk[] {
  const chunkSize = Math.min(4000, Math.max(64, options?.chunkSize ?? 1000));
  const chunkOverlap =
    'chunkOverlap' in (options ?? {})
      ? Math.max(0, (options as EffectiveChunkParams).chunkOverlap ?? 0)
      : Math.max(0, (options as { chunkOverlap?: number } | undefined)?.chunkOverlap ?? 0);
  const chunkSplitMode: ChunkSplitMode =
    (options as EffectiveChunkParams | undefined)?.chunkSplitMode ?? 'size';
  const headingDepth = (options as EffectiveChunkParams | undefined)?.headingDepth ?? 0;
  const minChunkSize = (options as EffectiveChunkParams | undefined)?.minChunkSize ?? 0;
  const chunkSplitter = (options as EffectiveChunkParams | undefined)?.chunkSplitter ?? '';
  const indexPrefixTitle = (options as EffectiveChunkParams | undefined)?.indexPrefixTitle ?? true;

  const normalized = text.replace(/\r\n/g, '\n');
  let parts: { title: string; content: string }[] = [];

  if (chunkSplitMode === 'paragraph') {
    parts = splitParagraphMode(normalized, headingDepth, minChunkSize, chunkSize);
  } else if (chunkSplitMode === 'char') {
    parts = splitByCustomSeparator(normalized, chunkSplitter, chunkSize).map((content) => ({
      title: '',
      content,
    }));
  } else {
    parts = recursiveSplit(normalized, SIZE_SEPARATORS, chunkSize, chunkOverlap).map((content) => ({
      title: '',
      content,
    }));
  }

  const chunks = toPreviewChunks(parts, fileName, normalized, indexPrefixTitle);
  if (!chunks.length && text.trim()) {
    const body = text.trim().slice(0, chunkSize);
    chunks.push({
      id: `${fileName}-1`,
      title: fileName,
      content: body,
      locator: '片段 1',
      tokens: Math.max(1, Math.floor(body.length / 2)),
    });
  }
  return chunks;
}

export async function readUploadText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (
    !(
      name.endsWith('.md') ||
      name.endsWith('.txt') ||
      name.endsWith('.csv') ||
      name.endsWith('.markdown')
    )
  ) {
    throw new Error('当前预览仅支持 Markdown / 纯文本 / CSV；PDF 等需入库后在详情页查看分块');
  }
  return file.text();
}
