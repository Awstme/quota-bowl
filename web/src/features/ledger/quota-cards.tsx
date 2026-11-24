import { Icon } from '../../app/ui';
import type { Metric, Target } from '../../lib/api/client';
import { DateTime } from './history';
import { providerName } from './labels';

const statuses = {
  pending: '等待采集',
  ok: '采集正常',
  failed: '采集失败',
} as const;

const windows = [
  { key: '5h_used_percent', label: '5 小时余量' },
  { key: 'weekly_used_percent', label: '每周余量' },
  { key: 'monthly_used_percent', label: '每月余量' },
];

const percentFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

export function Status({ status }: { status: Target['status'] }) {
  return <span className={`status status--${status}`}><i />{statuses[status]}</span>;
}

export function isStale(target: Target, now: number) {
  const collectedAt = target.latest ? Date.parse(target.latest.collectedAt) : NaN;
  return now - collectedAt > target.intervalSeconds * 2_000;
}

export function StaleLabel() {
  return <span className="stale-label"><Icon name="clock" />快照已过期</span>;
}

export function PercentMeter({ percent }: { percent: number }) {
  return <svg className="metric-meter" aria-hidden="true" viewBox="0 0 100 4" preserveAspectRatio="none">
    <rect width="100" height="4" rx="2" /><rect className="metric-meter-fill" width={percent} height="4" rx="2" />
  </svg>;
}

function remaining(metric: Metric | undefined) {
  if (metric?.unit !== '%' || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0) return;
  return Math.max(0, 100 - metric.value);
}

function formatPercent(percent: number) {
  return percent > 0 && percent < 0.01 ? '<0.01%' : `${percentFormatter.format(percent)}%`;
}

export function QuotaCards({ targets, now, onOpen }: { targets: Target[]; now: number; onOpen: (id: string) => void }) {
  return <ul className="quota-grid" aria-label="账号余量">
    {targets.map(target => {
      const metrics = target.latest?.metrics ?? [];
      const quotas = windows.flatMap(({ key, label }) => {
        const percent = remaining(metrics.find(metric => metric.key === key));
        return percent === undefined ? [] : [{ key, label, percent }];
      });
      const stale = isStale(target, now);
      return <li className="quota-card" key={target.id}>
        <div className="quota-card-head">
          <h2><button className="quota-card-open" type="button" id={`account-${target.id}`} onClick={() => onOpen(target.id)}>
            {target.label}<Icon name="chevron" />
          </button></h2>
          <div className="quota-card-meta">
            <p>{providerName(target.provider)}{target.workspaceId && <> · <code>{target.workspaceId}</code></>}</p>
            <div className="quota-card-status"><Status status={target.status} />{stale && <StaleLabel />}</div>
          </div>
        </div>
        {quotas.length ? <dl className="quota-windows">{quotas.map(({ key, label, percent }) => <div key={key}>
          <dt>{label}</dt><dd>{formatPercent(percent)}</dd>
          <dd className="quota-bar" aria-hidden="true"><PercentMeter percent={percent} /></dd>
        </div>)}</dl> : <p className="quota-card-empty">{target.latest ? '暂无可用余量' : '暂无采集数据'}</p>}
        {target.latest && <p className="quota-updated">上次成功采集 <DateTime value={target.latest.collectedAt} /></p>}
      </li>;
    })}
  </ul>;
}
