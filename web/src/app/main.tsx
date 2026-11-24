import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Ledger } from '../features/ledger/ledger';
import { AccessLayout, Login, sessionKey, SignOut } from '../features/session/session';
import { api, ApiError, errorMessage } from '../lib/api/client';
import type { Session } from '../lib/api/client';
import { Feedback, Header } from './ui';
import './styles.css';

type LocalSession = Session & { expired?: boolean };

function clearSession(expired = false) {
  void client.cancelQueries({ predicate: query => query.queryKey[0] !== 'session' });
  void client.cancelQueries({ queryKey: sessionKey });
  client.setQueryData<LocalSession>(sessionKey, { authenticated: false, expired });
  client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' });
}

function handleAuthError(error: Error) {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  const previous = client.getQueryData<LocalSession>(sessionKey);
  if (!previous?.authenticated) return;
  clearSession(true);
}

const client = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => { if (query.queryKey[0] !== 'session') handleAuthError(error); } }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: { queries: { retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status >= 500), staleTime: 15_000 } },
});

function App() {
  const session = useQuery<LocalSession>({
    queryKey: sessionKey,
    queryFn: ({ signal }) => api.session(signal),
    staleTime: Infinity,
  });
  const [sessionRecoveryError, setSessionRecoveryError] = useState(false);
  const token = session.data?.csrfToken;

  return <>
    <a href="#main-content" className="skip-link">跳至主要内容</a>
    {session.data?.authenticated ? <>
      <Header actions={<SignOut token={token} onSignOut={() => { setSessionRecoveryError(false); clearSession(); }} />} />
      {sessionRecoveryError && !token && <div className="global-feedback"><Feedback kind="error">重新验证失败，请重试或重新加载页面。</Feedback></div>}
      <Ledger csrfToken={token} recoverSession={() => {
        setSessionRecoveryError(false);
        void session.refetch().then(result => setSessionRecoveryError(result.isError || (result.data?.authenticated === true && !result.data.csrfToken)));
      }} />
    </> : session.data ? <Login expired={session.data.expired ?? false} /> : <AccessLayout>
      <h2>访问台账</h2>
      {session.isPending ? <Feedback>正在检查登录状态…</Feedback> : <Feedback kind="error" action={<button className="text-button" type="button" onClick={() => void session.refetch()}>重试</button>}>{errorMessage(session.error, '无法检查登录状态，请重试。')}</Feedback>}
    </AccessLayout>}
  </>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={client}><App /></QueryClientProvider></StrictMode>,
);
