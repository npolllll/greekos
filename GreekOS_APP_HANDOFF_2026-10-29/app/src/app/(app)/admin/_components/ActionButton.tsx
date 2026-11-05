'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** POSTs JSON to an admin API, optionally after a confirmation prompt, then refreshes server data. */
export function ActionButton(props: {
  url: string;
  body?: Record<string, unknown>;
  label: string;
  confirmText?: string;
  promptReason?: string;
  variant?: 'outline' | 'dark' | 'flat' | '';
  successText?: string;
  disabled?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (props.confirmText && !window.confirm(props.confirmText)) return;
    let body = props.body ?? {};
    if (props.promptReason) {
      const reason = window.prompt(props.promptReason);
      if (!reason || reason.trim().length < 3) return;
      body = { ...body, reason: reason.trim() };
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(props.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: json.message ?? 'Действие не выполнено' });
      else {
        setMsg({ ok: true, text: props.successText ?? 'Готово' });
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: 'Нет связи с сервером' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-form" style={{ display: 'inline-grid' }}>
      <button type="button" className={`btn ${props.variant ?? 'outline'}`} onClick={run} disabled={busy || props.disabled} title={props.title}>{busy ? 'Выполняю…' : props.label}</button>
      {msg ? <span className={msg.ok ? 'msg-ok' : 'error-text'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span> : null}
    </span>
  );
}
