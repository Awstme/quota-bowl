import type { ReactNode } from 'react';

type IconName = 'refresh' | 'exit' | 'chevron' | 'book' | 'clock' | 'target' | 'lock' | 'back' | 'enter';
const paths: Record<IconName, ReactNode> = {
  refresh: <><path d="M19 7v5h-5M5 17v-5h5" /><path d="M6.7 8a6 6 0 0 1 9.8-2L19 9M5 15l2.5 3A6 6 0 0 0 17.3 16" /></>,
  exit: <><path d="M10 4H5v16h5M9 12h11m-4-4 4 4-4 4" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  book: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 4v16m3-10h5m-5 4h5" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  target: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16m-11 4h2m3 0h2" /></>,
  lock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3m-3 4v2" /></>,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  enter: <path d="M5 12h14m-5-5 5 5-5 5" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className} aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Bowl({ className }: { className?: string }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="60" cy="51" rx="43" ry="13" />
    <path d="M17 51c1 20 14 34 32 38h22c18-4 31-18 32-38M40 96h40M74 49l23-32M82 51l27-28" />
    <path d="M29 59c3 10 10 17 18 20" opacity=".54" />
  </svg>;
}

export function Header({ actions }: { actions?: ReactNode }) {
  return <header className="masthead">
    <div className="brand"><span className="brand-mark"><Bowl /></span><strong>饭量</strong><span className="brand-rule" /><span className="brand-context">额度采集台账</span></div>
    {actions && <div className="masthead-actions">{actions}</div>}
  </header>;
}

export function Feedback({ children, kind = 'neutral', action }: { children: ReactNode; kind?: 'neutral' | 'error' | 'success'; action?: ReactNode }) {
  return <div className={`feedback feedback--${kind}`} role={kind === 'error' ? 'alert' : 'status'}><span>{children}</span>{action}</div>;
}
