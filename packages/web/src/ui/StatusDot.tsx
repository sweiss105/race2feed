import type { LiveStatus } from '../lib/live';

const LABEL: Record<LiveStatus, string> = { connecting: 'Connecting', open: 'Live', offline: 'Reconnecting', 'signed-out': 'Signed out' };

export function StatusDot({ status }: { status: LiveStatus }) {
  const color = status === 'open' ? 'var(--success)' : status === 'signed-out' ? 'var(--danger)' : 'var(--warning)';
  return (
    <span class="footnote secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }} role="status">
      <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: color }} />
      {LABEL[status]}
    </span>
  );
}
