import type { DocumentMetadata } from '../types';

export interface ExtractMetadataInput {
  fileName: string;
  format?: string;
  knowledgeBaseName?: string;
  owner?: string;
}

const subjectRules: Array<[RegExp, string]> = [
  [/部署/, '私有化部署'],
  [/报价|功能对照|版本功能/, '版本与报价'],
  [/常见问题|FAQ/i, '标准答复'],
  [/验收/, '交付验收'],
  [/巡检/, '门店巡检'],
  [/假期|考勤/, '假期与考勤'],
  [/员工手册/, '员工制度'],
  [/接口|规范/, '开放接口'],
  [/故障/, '故障处理'],
  [/合同/, '销售合同'],
  [/复盘/, '项目交付复盘'],
  [/手册/, '产品手册'],
];

function hashName(name: string) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function fileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function inferSubject(fileName: string, knowledgeBaseName?: string) {
  for (const [pattern, subject] of subjectRules) {
    if (pattern.test(fileName)) return subject;
  }
  const cleaned = fileStem(fileName)
    .replace(/[_-]+/g, ' ')
    .replace(/20\d{2}(?:\s*版|Q[1-4])?/gi, '')
    .replace(/[Vv]\d+(?:\.\d+)*/g, '')
    .replace(/标准版|图文版|扫描件/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 2) return cleaned;
  return knowledgeBaseName?.replace(/知识库$/, '') || '未命名文档';
}

function inferVersion(fileName: string, hash: number) {
  const semver = fileName.match(/[Vv](\d+(?:\.\d+)*)/);
  if (semver) return `V${semver[1]}`;
  const yearEdition = fileName.match(/(20\d{2})\s*版/);
  if (yearEdition) return `${yearEdition[1]}版`;
  const quarter = fileName.match(/(20\d{2})\s*Q([1-4])/i);
  if (quarter) return `${quarter[1]} Q${quarter[2]}`;
  if (fileName.includes('标准版')) return '标准版';
  if (fileName.includes('图文版')) return '图文版';
  return `2026.${1 + (hash % 3)}`;
}

function inferTime(fileName: string, hash: number) {
  const quarter = fileName.match(/(20\d{2})\s*Q([1-4])/i);
  if (quarter) {
    const month = String(Number(quarter[2]) * 3).padStart(2, '0');
    const lastDay = quarter[2] === '1' || quarter[2] === '4' ? '31' : '30';
    return `${quarter[1]}-${month}-${lastDay}`;
  }
  const year = fileName.match(/20\d{2}/);
  if (year) {
    const day = String(10 + (hash % 18)).padStart(2, '0');
    return `${year[0]}-10-${day}`;
  }
  const month = String(1 + (hash % 10)).padStart(2, '0');
  const day = String(1 + (hash % 27)).padStart(2, '0');
  return `2026-${month}-${day}`;
}

function inferKeywords(input: ExtractMetadataInput, subject: string, version: string) {
  const formatLabel = (input.format || input.fileName.split('.').pop() || 'FILE')
    .replace(/^\./, '')
    .toUpperCase();
  const tokens = fileStem(input.fileName)
    .split(/[\s_+·.\-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !/^[\d.]+$/.test(part) && !/^v\d/i.test(part));
  const knowledgeLabel = input.knowledgeBaseName?.replace(/知识库$/, '').slice(0, 12);
  const candidates = [subject, version, formatLabel, ...tokens, knowledgeLabel].filter(
    (item): item is string => Boolean(item),
  );
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of candidates) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(item);
    if (keywords.length >= 6) break;
  }
  return keywords;
}

function inferQuestions(subject: string, version: string, owner: string) {
  return [
    `${subject}的适用范围是什么？`,
    `${subject}当前是哪个版本，和上一版有什么差别？`,
    `${subject}（${version}）由谁负责维护？`,
    `${owner}如何更新${subject}？`,
  ];
}

/** 用文件名、格式和知识库上下文模拟抽取，不同文件得到不同索引字段。 */
export function extractDocumentMetadata(input: ExtractMetadataInput): DocumentMetadata {
  const hash = hashName(input.fileName);
  const subject = inferSubject(input.fileName, input.knowledgeBaseName);
  const version = inferVersion(input.fileName, hash);
  const owner = input.owner?.trim() || '未指定负责人';
  return {
    time: inferTime(input.fileName, hash),
    version,
    subject,
    owner,
    keywords: inferKeywords(input, subject, version),
    questions: inferQuestions(subject, version, owner),
  };
}
