'use client';
import { useState } from 'react';

export function CopyBox({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="copy-box">
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn outline" onClick={async () => { await navigator.clipboard.writeText(value).catch(() => undefined); setCopied(true); }}>{copied ? 'Скопировано' : 'Копировать'}</button>
      </div>
      <p className="warning-note">Ссылка одноразовая и действует ограниченное время. Передайте её только этому ученику; повторно она не показывается.</p>
    </div>
  );
}
