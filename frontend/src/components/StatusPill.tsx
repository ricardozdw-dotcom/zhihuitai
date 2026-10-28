import { Badge } from 'antd';
import type { KnowledgeStatus } from '../types';

interface StatusPillProps {
  status: KnowledgeStatus | 'success' | 'error' | 'empty' | 'healthy' | 'untested';
  label?: string;
}

const statusMap = {
  ready: { color: '#20A779', label: '已就绪', background: '#EAF8F2' },
  processing: { color: '#5B67F1', label: '处理中', background: '#EEF0FF' },
  warning: { color: '#E7A13D', label: '需复核', background: '#FFF7E7' },
  disabled: { color: '#9097A8', label: '已停用', background: '#F1F3F6' },
  success: { color: '#20A779', label: '成功', background: '#EAF8F2' },
  error: { color: '#E65F5C', label: '失败', background: '#FFF0EF' },
  empty: { color: '#E7A13D', label: '无匹配', background: '#FFF7E7' },
  healthy: { color: '#20A779', label: '连接正常', background: '#EAF8F2' },
  untested: { color: '#9097A8', label: '未测试', background: '#F1F3F6' },
} as const;

export function StatusPill({ status, label }: StatusPillProps) {
  const config = statusMap[status];
  return (
    <span
      className="status-pill"
      style={{ color: config.color, background: config.background }}
    >
      <Badge color={config.color} />
      {label ?? config.label}
    </span>
  );
}
