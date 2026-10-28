import { Tag } from 'antd';
import type { DocumentMetadata } from '../types';

const facts: Array<{ key: keyof Pick<DocumentMetadata, 'time' | 'version' | 'subject' | 'owner'>; label: string }> = [
  { key: 'time', label: '时间' },
  { key: 'version', label: '版本' },
  { key: 'subject', label: '主体信息' },
  { key: 'owner', label: '负责人' },
];

export function DocumentMetadataView({ metadata }: { metadata: DocumentMetadata }) {
  return (
    <div className="document-metadata">
      <dl className="document-metadata__facts">
        {facts.map((fact) => (
          <div key={fact.key}>
            <dt>{fact.label}</dt>
            <dd>{metadata[fact.key]}</dd>
          </div>
        ))}
      </dl>
      <div className="document-metadata__block">
        <span>便于检索的关键词</span>
        <div className="document-metadata__tags">
          {metadata.keywords.map((keyword) => (
            <Tag key={keyword}>{keyword}</Tag>
          ))}
        </div>
      </div>
      <div className="document-metadata__block">
        <span>可能被问到的问题</span>
        <ul>
          {metadata.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
