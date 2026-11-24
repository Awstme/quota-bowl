import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bowl, Feedback, Header, Icon } from '../../app/ui';
import { api, errorMessage } from '../../lib/api/client';

export const sessionKey = ['session'] as const;

export function AccessLayout({ children }: { children: ReactNode }) {
  return <>
    <Header />
    <main id="main-content" className="access" tabIndex={-1}>
      <div className="access-intro">
        <div className="access-art"><span /><Bowl /><span /></div>
        <h1>额度采集台账</h1>
        <p>查看各目标的最新额度、采集状态与历史快照。</p>
      </div>
      <div className="access-body">{children}</div>
    </main>
  </>;
}

export function Login({ expired }: { expired: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const client = useQueryClient();
  // Keep the password out of mutation variables and the shared query cache.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username || !password || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.login(username, password);
      setPassword('');
      await client.cancelQueries({ queryKey: sessionKey });
      client.setQueryData(sessionKey, session);
    } catch (failure) {
      setError(failure);
    } finally {
      setSubmitting(false);
    }
  }

  return <AccessLayout>
    <span className="access-body-icon"><Icon name="lock" /></span>
    <h2>登录饭量</h2>
    {expired && !error && <Feedback>登录已失效，请重新登录。</Feedback>}
    <form onSubmit={submit}>
      <label htmlFor="access-username">用户名</label>
      <input id="access-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={event => { setUsername(event.target.value); setError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} disabled={submitting} />
      <label htmlFor="access-password">密码</label>
      <input id="access-password" type="password" name="password" autoComplete="current-password" required value={password} onChange={event => { setPassword(event.target.value); setError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} disabled={submitting} />
      {Boolean(error) && <div id="login-error" className="form-error" role="alert">{errorMessage(error, '暂时无法登录，请稍后重试。')}</div>}
      <button className="button button--primary login-button" type="submit" disabled={submitting || !username || !password}>{submitting ? '正在登录…' : '登录'}<Icon name="enter" /></button>
    </form>
  </AccessLayout>;
}

export function SignOut({ token, onSignOut }: { token?: string; onSignOut: () => void }) {
  const logout = useMutation({ mutationFn: () => api.logout(token ?? ''), onSuccess: onSignOut });
  return <div className="sign-out">
    {logout.isError && <span role="alert">{errorMessage(logout.error, '退出失败，请重试。')}</span>}
    <button className="button button--bare" type="button" onClick={() => logout.mutate()} disabled={!token || logout.isPending}>
      <Icon name="exit" />{logout.isPending ? '正在退出…' : '退出登录'}
    </button>
  </div>;
}
