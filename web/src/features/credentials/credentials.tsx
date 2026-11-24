import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Feedback } from '../../app/ui';
import { api, ApiError, errorMessage } from '../../lib/api/client';
import type { Target } from '../../lib/api/client';

const sources = { managed: '面板保存', file: '本地文件', unconfigured: '未配置' } as const;

type Props = {
  target: Target;
  csrfToken?: string;
  onChange: (source: Target['credentialSource']) => void;
};

export function Credentials({ target, csrfToken, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: (action: 'save' | 'remove') => {
      if (action === 'remove') return api.removeCredential(target.id, csrfToken ?? '');
      const field = input.current!;
      const value = field.value;
      field.value = '';
      return api.saveCredential(target.id, value, csrfToken ?? '');
    },
    onSuccess: (_, action) => {
      setConfirmRemoval(false);
      onChange(action === 'save' ? 'managed' : target.credentialFileConfigured ? 'file' : 'unconfigured');
    },
  });
  const label = target.provider === 'opendesign' ? 'Cookie' : 'API Key';
  const managed = target.credentialSource === 'managed';
  const disabled = !csrfToken || mutation.isPending;
  const removeLabel = target.credentialFileConfigured ? '改用本地文件' : '移除密钥';
  const failure = mutation.error;
  const message = failure instanceof ApiError && ['invalid_credential', 'body_too_large', 'target_changed'].includes(failure.code)
    ? failure.message : errorMessage(failure, '密钥操作失败，请重试。');

  return <section className="panel-section" id="ledger-records" aria-labelledby="credentials-heading">
    <div className="section-heading"><h3 id="credentials-heading">密钥管理</h3>
      <span className="section-aside">当前来源 · {sources[target.credentialSource]}</span>
    </div>
    <form className="credential-form" autoComplete="off" onSubmit={event => {
      event.preventDefault();
      if (!disabled) mutation.mutate('save');
    }}>
      <label htmlFor="provider-credential">新的 {label}</label>
      <input id="provider-credential" ref={input} type="password" autoComplete="new-password" spellCheck={false}
        autoCapitalize="none" aria-describedby="credential-hint" required maxLength={65536} disabled={disabled} />
      <div id="credential-hint" className="credential-hint">
        {target.provider === 'opendesign' ? '粘贴 Cookie 请求头的值。' : '粘贴该目标账号的 API Key。'}
        {target.workspaceId && <>此 Cookie 须属于工作区 <code>{target.workspaceId}</code>。</>}
      </div>
      <div><button className="button button--primary" type="submit" disabled={disabled}>
        {mutation.isPending && mutation.variables === 'save' ? '正在保存…' : '保存密钥'}
      </button></div>
    </form>
    {managed && <div className="credential-remove">
      {confirmRemoval ? <>
        <p>{target.credentialFileConfigured ? '将移除面板保存的密钥，并在下次采集时读取本地文件。' : '移除后，这个目标需要重新配置密钥才能采集。'}</p>
        <div className="credential-actions">
          <button className="button button--secondary" type="button" disabled={disabled} onClick={() => mutation.mutate('remove')}>
            {mutation.isPending ? '正在处理…' : `确认${removeLabel}`}
          </button>
          <button className="button button--bare" type="button" disabled={mutation.isPending} onClick={() => setConfirmRemoval(false)}>取消</button>
        </div>
      </> : <button className="button button--secondary" type="button" disabled={disabled} onClick={() => setConfirmRemoval(true)}>{removeLabel}</button>}
    </div>}
    {mutation.isSuccess && <Feedback kind="success">{mutation.variables === 'save' ? '密钥已保存。' : '面板密钥已移除。'}</Feedback>}
    {mutation.isError && <Feedback kind="error">{message}</Feedback>}
  </section>;
}
