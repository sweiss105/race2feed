export function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul class="list" role="alert" style={{ border: '1px solid var(--danger)' }}>
      {items.map((p) => <li key={p} class="callout" style={{ color: 'var(--danger)' }}>{p}</li>)}
    </ul>
  );
}
