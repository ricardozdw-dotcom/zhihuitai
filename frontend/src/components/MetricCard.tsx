import type { ReactNode } from 'react';
import { Card } from 'antd';

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  trend?: string;
  tone?: 'purple' | 'blue' | 'green' | 'orange';
  helper?: string;
}

export function MetricCard({
  icon,
  label,
  value,
  trend,
  tone = 'purple',
  helper,
}: MetricCardProps) {
  return (
    <Card className="metric-card surface-card" bordered={false}>
      <div className={`metric-card__icon metric-card__icon--${tone}`}>{icon}</div>
      <div className="metric-card__body">
        <span>{label}</span>
        <strong className="numeric">{value}</strong>
        <div className="metric-card__footer">
          {trend ? <em>{trend}</em> : null}
          {helper ? <small>{helper}</small> : null}
        </div>
      </div>
    </Card>
  );
}
