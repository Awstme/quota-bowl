import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Feedback } from '../../app/ui';
import { api, ApiError, errorMessage } from '../../lib/api/client';

type Props = {
  token: string;
  onAdded: (id: string) => void;
  onDismiss: () => void;
};

export function AddAccount({ token, onAdded, onDismiss }: Props) {
  const [id] = useState(() => crypto.randomUUID());
  const [provider, setProvider] = useState('opencodego');
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLInputElement>(null);
  const credential = useRef<HTMLInputElement>(null);
  const needsWorkspace = provider === 'opendesign';
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: () => api.createAccount({
      id, provider, label: label.current?.value ?? '',
      workspaceId: workspace.current?.value, credential: credential.current?.value ?? '',
    }, token),
    onSuccess: ({ id: added }) => {
      if (credential.current) credential.current.value = '';
      dialog.current?.close();
      onAdded(added);
    },
  });
  const failure = mutation.error;
  const message = failure instanceof ApiError && ['invalid_target', 'invalid_credential', 'body_too_large', 'target_exists'].includes(failure.code)
    ? failure.message : errorMessage(failure, '新增账号失败，请重试。');

  return <dialog ref={dialog} id="add-account" className="add-account" aria-labelledby="add-account-heading"
    onClose={onDismiss} onCancel={event => { if (mutation.isPending) event.preventDefault(); }}>
    <h2 id="add-account-heading">新增账号</h2>
    <form className="credential-form add-account-form" onSubmit={event => {
      event.preventDefault();
      if (!mutation.isPending) mutation.mutate();
    }}>
      <div className="account-field">
        <label htmlFor="account-provider">渠道</label>
        <select id="account-provider" value={provider} onChange={event => setProvider(event.target.value)} disabled={mutation.isPending}>
          <option value="opencodego">OpenCode Go</option>
          <option value="commandcode">Command Code</option>
          <option value="opendesign">OpenDesign</option>
        </select>
      </div>
      <div className="account-field">
        <label htmlFor="account-name">账号名称</label>
        <input id="account-name" ref={label} autoComplete="off" required maxLength={100} disabled={mutation.isPending} />
      </div>
      {needsWorkspace && <div className="account-field">
        <label htmlFor="account-workspace">工作区 ID</label>
        <input id="account-workspace" ref={workspace} autoComplete="off" required maxLength={128} disabled={mutation.isPending} />
      </div>}
      <div className="account-field">
        <label htmlFor="account-credential">{needsWorkspace ? 'Cookie' : 'API Key'}</label>
        <input id="account-credential" key={provider} ref={credential} type="password" autoComplete="new-password"
          spellCheck={false} required maxLength={65536} disabled={mutation.isPending} />
      </div>
      <div className="account-submit">
        <button className="button button--bare" type="button" disabled={mutation.isPending} onClick={() => dialog.current?.close()}>取消</button>
        <button className="button button--primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? '正在添加…' : '添加账号'}
        </button>
      </div>
    </form>
    {mutation.isError && <Feedback kind="error">{message}</Feedback>}
  </dialog>;
}
