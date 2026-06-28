// MRO field link manager — enable / show / copy / rotate / disable the
// login-free field-capture link, all in-app (no Supabase dashboard).
// Stores the token in mro_config; the mro-field-upload function reads it.
import { useState } from 'react';
import { useMroFieldToken, useSetMroFieldToken, genFieldToken } from '../../hooks/useMroBilling';

export function MroFieldLink() {
  const tokenQ = useMroFieldToken();
  const setTok = useSetMroFieldToken();
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const token = tokenQ.data ?? null;
  const link = token ? `${location.origin}/field/receipt?k=${token}` : '';

  const run = (value: string | null, msg?: string) => {
    setErr(null);
    if (msg && !confirm(msg)) return;
    setTok.mutate(value, { onError: (e) => setErr((e as Error).message) });
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setErr('Copy failed — select the link and copy manually.'); }
  };

  return (
    <details className="t-small t-muted mt-0.5">
      <summary style={{ cursor: 'pointer' }}>
        Login-free field link {token
          ? <span style={{ color: 'var(--color-ok, #10b981)', fontWeight: 600 }}>· ON</span>
          : <span className="t-muted">· off</span>}
      </summary>
      <div className="mt-1" style={{ fontSize: '0.74rem', maxWidth: 720 }}>
        <p className="mb-1">
          For techs with no dashboard account: share this link, they snap + tag a receipt, it lands in the pool. No login.
        </p>
        {err && <p className="t-danger mb-1">{err}</p>}

        {tokenQ.isLoading ? <span className="t-muted">…</span>
          : !token ? (
          <button type="button" disabled={setTok.isPending} onClick={() => run(genFieldToken())}
            className="t-small t-accent" style={btn}>
            {setTok.isPending ? 'Enabling…' : '🔑 Enable field link'}
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <code style={{ background: 'var(--color-bg)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', wordBreak: 'break-all', flex: 1, minWidth: 220 }}>{link}</code>
              <button type="button" onClick={copy} className="t-small t-accent" style={btn}>{copied ? '✓ Copied' : 'Copy'}</button>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" disabled={setTok.isPending} onClick={() => run(genFieldToken(), 'Rotate the token? The current link stops working immediately — you must re-share the new one.')}
                className="t-small t-muted" style={{ ...btn, borderColor: 'var(--color-border)' }}>↻ Rotate</button>
              <button type="button" disabled={setTok.isPending} onClick={() => run(null, 'Disable field capture? The link stops working until you enable again.')}
                className="t-small" style={{ ...btn, borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>Disable</button>
            </div>
            <p className="t-muted mt-1" style={{ fontSize: '0.68rem' }}>
              Anyone with the link can upload receipt images (only) — rotate if it leaks.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

const btn: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-card)', cursor: 'pointer',
};
