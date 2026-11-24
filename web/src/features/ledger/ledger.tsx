import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feedback, Icon } from '../../app/ui';
import { AddAccount } from '../credentials/add-account';
import { Credentials } from '../credentials/credentials';
import { api, errorMessage } from '../../lib/api/client';
import type { Metric, Target, TargetsResponse } from '../../lib/api/client';
import { DateTime, History, metricValue } from './history';
import { collectionError, metricLabel, providerName } from './labels';
import { isStale, PercentMeter, QuotaCards, StaleLabel, Status } from './quota-cards';

function interval(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400} 天`;
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function Meter({ metric }: { metric: Metric }) {
  const value = typeof metric.value === 'number' ? metric.value : NaN;
  if (metric.unit !== '%' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return <PercentMeter percent={value} />;
}

function Overview({ target, stale }: { target: Target; stale: boolean }) {
  const latest = target.latest;
  return <section className="panel-section" id="ledger-records" aria-labelledby="snapshot-heading">
    <div className="section-heading"><h3 id="snapshot-heading"><Icon name="book" />最新额度</h3>
      {latest && <span className="section-aside">快照于 <DateTime value={latest.collectedAt} /></span>}
    </div>
    {target.status === 'failed' && <Feedback kind="error">
      {latest ? '最近一次采集失败，下方仍显示上一次成功的快照。' : '最近一次采集失败，还没有可用快照。'}
      {collectionError(target.errorCode)}
    </Feedback>}
    {stale && <Feedback>这份快照已超过两倍采集间隔，仅供参考。</Feedback>}
    {!latest && <div className="empty-inline">{target.status === 'pending' ? '正在等待首次采集。也可以点击「立即采集」手动发起。' : '没有已保存的快照。可点击「立即采集」重试。'}</div>}
    {latest && latest.metrics.length === 0 && <div className="empty-inline">这条快照没有额度指标。</div>}
    {latest && latest.metrics.length > 0 && <dl className="metrics">{latest.metrics.map(metric =>
      <div className="metric" key={metric.key}>
        <dt>{metricLabel(metric)}</dt>
        <dd><div className="metric-reading"><span>{metricValue(metric)}</span>{metric.unit && <span className="metric-unit">{metric.unit}</span>}</div><Meter metric={metric} /></dd>
        {metric.resetsAt && <dd className="metric-reset">重置于 <DateTime value={metric.resetsAt} /></dd>}
      </div>,
    )}</dl>}
  </section>;
}

const fastPoll = 2_000;
const waitLimit = 60_000;
type Update =
  | { kind: 'waiting'; baseline: string; expiresAt: number }
  | { kind: 'done' }
  | { kind: 'failed' }
  | { kind: 'delayed'; baseline: string }
  | { kind: 'error'; message: string };

type CollectionState = Pick<Target, 'id' | 'status' | 'lastAttemptAt' | 'latest'>;

function revision(target: CollectionState) {
  return JSON.stringify([target.status, target.lastAttemptAt, target.latest?.collectedAt]);
}

function requestFeedback(update?: Update) {
  switch (update?.kind) {
    case 'waiting': return <Feedback>采集请求已受理，正在等待结果。</Feedback>;
    case 'done': return <Feedback kind="success">已收到新的采集结果。</Feedback>;
    case 'failed': return <Feedback kind="error">已收到采集结果：本次采集失败。</Feedback>;
    case 'delayed': return <Feedback>采集请求已受理，但尚未收到结果。页面会继续更新状态。</Feedback>;
    case 'error': return <Feedback kind="error">{update.message}</Feedback>;
    default: return null;
  }
}

export function Ledger({ csrfToken, recoverSession }: { csrfToken?: string; recoverSession: () => void }) {
  const queryClient = useQueryClient();
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const navigationFocus = useRef<string | undefined>(undefined);
  const [page, setPage] = useState<'overview' | 'history' | 'credentials'>('overview');
  const [updates, setUpdates] = useState<Record<string, Update>>({});
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    const timer = window.setInterval(updateClock, 10_000);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, []);
  const fast = Object.values(updates).some(update => update.kind === 'waiting');
  const tracking = fast || Object.values(updates).some(update => update.kind === 'delayed');
  const targetsQuery = useQuery({
    queryKey: ['targets'],
    queryFn: ({ signal }) => api.targets(signal),
    refetchInterval: fast ? fastPoll : 30_000,
  });
  const targets = targetsQuery.data?.targets;
  const providerCounts = new Map<string, number>();
  for (const { provider } of targets ?? []) {
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
  }
  const channels = [...providerCounts].sort(([left], [right]) => providerName(left).localeCompare(providerName(right)));
  const activeProvider = selectedProvider && providerCounts.has(selectedProvider) ? selectedProvider : undefined;
  const visibleTargets = activeProvider ? targets?.filter(entry => entry.provider === activeProvider) : targets;
  const target = targets?.find(entry => entry.id === selectedId);
  useEffect(() => {
    if (navigationFocus.current) {
      document.getElementById(navigationFocus.current)?.focus();
      navigationFocus.current = undefined;
    }
  }, [target?.id]);

  function openTarget(id: string) {
    navigationFocus.current = 'target-heading';
    setShowAddAccount(false);
    setPage('overview');
    setSelectedId(id);
  }

  function returnToAccounts() {
    navigationFocus.current = target ? `account-${target.id}` : undefined;
    if (target && activeProvider && target.provider !== activeProvider) setSelectedProvider(target.provider);
    setSelectedId(undefined);
  }

  function trackCollection(entry: CollectionState) {
    setUpdates(previous => ({
      ...previous,
      [entry.id]: { kind: 'waiting', baseline: revision(entry), expiresAt: Date.now() + waitLimit },
    }));
    void targetsQuery.refetch();
  }
  function credentialChanged(entry: Target, source: Target['credentialSource']) {
    queryClient.setQueryData<TargetsResponse>(['targets'], current => current && {
      ...current, targets: current.targets.map(target => target.id === entry.id ? { ...target, credentialSource: source } : target),
    });
    trackCollection(entry);
  }
  const request = useMutation({
    mutationFn: (entry: Target) => api.refresh(entry.id, csrfToken ?? ''),
    onSuccess: (_, entry) => trackCollection(entry),
    onError: (error, entry) => {
      setUpdates(previous => ({ ...previous, [entry.id]: { kind: 'error', message: errorMessage(error, '没有发起采集，请稍后重试。') } }));
    },
  });

  useEffect(() => {
    if (!tracking) return;
    const current = new Map(targets?.map(entry => [entry.id, entry]));
    function reconcile() {
      setUpdates(previous => {
        const next = { ...previous };
        let changed = false;
        for (const [id, update] of Object.entries(previous)) {
          if (update.kind !== 'waiting' && update.kind !== 'delayed') continue;
          const entry = current.get(id);
          if (entry && entry.status !== 'pending' && revision(entry) !== update.baseline) {
            next[id] = { kind: entry.status === 'ok' ? 'done' : 'failed' };
            changed = true;
          } else if (update.kind === 'waiting' && Date.now() >= update.expiresAt) {
            next[id] = { kind: 'delayed', baseline: update.baseline };
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    }
    reconcile();
    const deadlines = Object.values(updates).flatMap(update => update.kind === 'waiting' ? [update.expiresAt] : []);
    if (!deadlines.length) return;
    const timer = window.setTimeout(reconcile, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [targets, tracking, updates]);

  const counts = visibleTargets?.reduce((total, entry) => ({ ...total, [entry.status]: total[entry.status] + 1 }), { ok: 0, pending: 0, failed: 0 });
  const currentUpdate = target && Object.hasOwn(updates, target.id) ? updates[target.id] : undefined;
  const sending = request.isPending && request.variables?.id === target?.id;

  return <main id="main-content" className="workspace" tabIndex={-1}>
    <div className="workspace-heading">
      {target ? <button className="button button--secondary" type="button" onClick={returnToAccounts}>
        <Icon name="back" />返回账号余量
      </button> : <h1>账号余量</h1>}
      <div className="workspace-tools">
        {!target && targets && csrfToken &&
          <button className="button button--secondary" type="button" aria-haspopup="dialog"
            aria-controls={showAddAccount ? 'add-account' : undefined}
            onClick={() => setShowAddAccount(true)}>新增账号</button>}
        {!target && counts && <dl className="counts">
          <div><dt><span className="summary-dot summary-dot--ok" />成功</dt><dd>{counts.ok}</dd></div>
          <div><dt><span className="summary-dot summary-dot--pending" />等待</dt><dd>{counts.pending}</dd></div>
          <div><dt><span className="summary-dot summary-dot--failed" />失败</dt><dd>{counts.failed}</dd></div>
        </dl>}
      </div>
    </div>
    {showAddAccount && csrfToken && targets &&
      <AddAccount token={csrfToken} onDismiss={() => setShowAddAccount(false)} onAdded={id => {
        openTarget(id);
        trackCollection({ id, status: 'pending' });
      }} />}
    {!csrfToken && <Feedback kind="error" action={<button className="text-button" type="button" onClick={recoverSession}>重新验证</button>}>当前无法验证操作。仍可浏览记录。重新验证后可以提交操作。</Feedback>}
    {targetsQuery.isPending && <div className="ledger-blank"><Icon name="book" /><Feedback>正在读取采集目标…</Feedback></div>}
    {targetsQuery.isError && <Feedback kind="error" action={<button className="text-button" type="button" onClick={() => void targetsQuery.refetch()}>重试</button>}>{errorMessage(targetsQuery.error, targets ? '未能更新采集目标。下方仍显示上一次读取的结果。' : '采集目标加载失败，请重试。')}</Feedback>}
    {targets?.length === 0 && <div className="ledger-blank"><Icon name="target" /><h2>还没有采集目标</h2><p>可在台账顶部添加账号。</p><button className="button button--secondary" type="button" onClick={() => void targetsQuery.refetch()} disabled={targetsQuery.isFetching}><Icon name="refresh" />{targetsQuery.isFetching ? '正在读取…' : '重新读取'}</button></div>}
    {!target && !!visibleTargets?.length && <>
      <div className="channel-filters" role="group" aria-label="渠道筛选">
        <button type="button" aria-pressed={activeProvider === undefined} onClick={() => setSelectedProvider(undefined)}>
          全部 <span>{targets?.length}</span>
        </button>
        {channels.map(([provider, count]) => <button key={provider} type="button"
          aria-pressed={provider === activeProvider} onClick={() => setSelectedProvider(provider)}>
          {providerName(provider)} <span>{count}</span>
        </button>)}
      </div>
      <QuotaCards targets={visibleTargets} now={clock} onOpen={openTarget} />
    </>}
    {target && <div className="account-detail">
      <article className="target-sheet" aria-labelledby="target-heading">
        <header className="sheet-header">
          <div className="sheet-identity"><div className="sheet-status"><Status status={target.status} />{isStale(target, clock) && <StaleLabel />}</div><h1 id="target-heading" tabIndex={-1}>{target.label}</h1>
            <div className="sheet-source"><span>{providerName(target.provider)}</span>{target.workspaceId && <span>工作区 <code>{target.workspaceId}</code></span>}</div>
          </div>
          <button className="button button--primary" type="button" disabled={!csrfToken || request.isPending || currentUpdate?.kind === 'waiting'} onClick={() => {
            setUpdates(previous => { const next = { ...previous }; delete next[target.id]; return next; });
            request.mutate(target);
          }}><Icon name="refresh" />{sending ? '正在提交…' : currentUpdate?.kind === 'waiting' ? '等待结果…' : '立即采集'}</button>
        </header>
        <dl className="sheet-meta"><div><dt>采集频率</dt><dd>每 {interval(target.intervalSeconds)}</dd></div><div><dt>最近一次尝试</dt><dd><DateTime value={target.lastAttemptAt} /></dd></div></dl>
        <div className="sheet-nav" role="group" aria-label="台账视图">
          <button type="button" aria-pressed={page === 'overview'} aria-controls="ledger-records" onClick={() => setPage('overview')}>概览</button>
          <button type="button" aria-pressed={page === 'history'} aria-controls="ledger-records" onClick={() => setPage('history')}>采集历史</button>
          <button type="button" aria-pressed={page === 'credentials'} aria-controls="ledger-records" onClick={() => setPage('credentials')}>密钥管理</button>
        </div>
        {(sending || currentUpdate) && <div className="sheet-feedback">{sending ? <Feedback>正在提交采集请求…</Feedback> : requestFeedback(currentUpdate)}</div>}
        {page === 'overview' && <Overview target={target} stale={isStale(target, clock)} />}
        {page === 'history' && <History target={target} />}
        {page === 'credentials' && <Credentials key={target.id} target={target} csrfToken={csrfToken}
          onChange={source => credentialChanged(target, source)} />}
      </article>
    </div>}
  </main>;
}
