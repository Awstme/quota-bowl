import { useQuery } from '@tanstack/react-query';
import { Feedback, Icon } from '../../app/ui';
import { api, errorMessage } from '../../lib/api/client';
import type { Metric, Target } from '../../lib/api/client';
import { metricLabel } from './labels';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 15 });

export function DateTime({ value, fallback = '暂无' }: { value?: string; fallback?: string }) {
  if (!value) return <>{fallback}</>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <>{fallback}</>;
  return <time dateTime={value}>{dateFormatter.format(date)}</time>;
}

export function metricValue(metric: Metric) {
  return typeof metric.value === 'number' ? numberFormatter.format(metric.value) : metric.value;
}

export function History({ target }: { target: Target }) {
  const history = useQuery({
    queryKey: ['history', target.id, target.latest?.collectedAt ?? null],
    queryFn: ({ signal }) => api.history(target.id, signal),
  });
  const snapshots = history.data?.snapshots;

  return <section className="panel-section" id="ledger-records" aria-labelledby="history-heading">
    <div className="section-heading"><h3 id="history-heading"><Icon name="clock" />历史快照</h3>{snapshots && <span className="section-aside">{snapshots.length} 条记录</span>}</div>
    <p className="section-description">按采集时间从新到旧排列。</p>
    {history.isPending && <Feedback>正在读取历史快照…</Feedback>}
    {history.isError && <Feedback kind="error" action={<button className="text-button" type="button" onClick={() => void history.refetch()}>重试</button>}>{errorMessage(history.error, '历史快照加载失败，请重试。')}</Feedback>}
    {snapshots?.length === 0 && <div className="empty-inline">还没有历史快照。首次采集成功后，记录会出现在这里。</div>}
    {!!snapshots?.length && <ol className="timeline">
      {snapshots.map((snapshot, index) => <li key={`${snapshot.collectedAt}-${index}`}>
        <div className="timeline-meta"><span className="timeline-node" /><DateTime value={snapshot.collectedAt} />{index === 0 && <span className="history-tag">最新</span>}</div>
        {snapshot.metrics.length === 0 ? <p className="timeline-empty">这条快照没有额度指标。</p> :
          <dl className="history-metrics">{snapshot.metrics.map(metric => <div key={metric.key}>
            <dt>{metricLabel(metric)}</dt><dd>{metricValue(metric)}{metric.unit && <span className="metric-unit">{metric.unit}</span>}</dd>
            {metric.resetsAt && <dd className="metric-reset">重置于 <DateTime value={metric.resetsAt} /></dd>}
          </div>)}</dl>}
      </li>)}
    </ol>}
  </section>;
}
