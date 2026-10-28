import { describe, expect, it } from 'vitest';
import { documentsByKnowledgeBase } from './mock';
import { extractDocumentMetadata } from './extract-metadata';

describe('extractDocumentMetadata', () => {
  it('fills all six index fields from the file name', () => {
    const metadata = extractDocumentMetadata({
      fileName: '产品手册_2026版.docx',
      format: 'DOCX',
      knowledgeBaseName: '产品与解决方案知识库',
      owner: '知识运营组',
    });

    expect(metadata.time).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
    expect(metadata.version).toBe('2026版');
    expect(metadata.subject).toBe('产品手册');
    expect(metadata.owner).toBe('知识运营组');
    expect(metadata.keywords.length).toBeGreaterThan(0);
    expect(metadata.questions.length).toBeGreaterThan(0);
    expect(metadata.questions.some((question) => question.includes('产品手册'))).toBe(true);
  });

  it('gives different files different subject and version', () => {
    const manual = extractDocumentMetadata({
      fileName: '产品手册_2026版.docx',
      owner: '知识运营组',
    });
    const guide = extractDocumentMetadata({
      fileName: '部署与运维指南_图文版.pdf',
      owner: '平台研发部',
    });

    expect(guide.subject).toBe('私有化部署');
    expect(guide.version).toBe('图文版');
    expect(manual.subject).not.toBe(guide.subject);
    expect(manual.version).not.toBe(guide.version);
    expect(manual.questions[0]).not.toBe(guide.questions[0]);
  });

  it('attaches metadata to every seeded document', () => {
    const documents = Object.values(documentsByKnowledgeBase).flat();
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document.metadata.time).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
      expect(document.metadata.version.length).toBeGreaterThan(0);
      expect(document.metadata.subject.length).toBeGreaterThan(0);
      expect(document.metadata.owner.length).toBeGreaterThan(0);
      expect(document.metadata.keywords.length).toBeGreaterThan(0);
      expect(document.metadata.questions.length).toBeGreaterThan(0);
    }
    const subjects = new Set(
      documentsByKnowledgeBase['kb-product'].map((document) => document.metadata.subject),
    );
    expect(subjects.size).toBeGreaterThan(1);
  });
});
