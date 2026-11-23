import { useEffect } from 'preact/hooks';

/** A centred modal sheet. Escape or a tap outside closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: preact.ComponentChildren }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const id = `sheet-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div class="sheet-scrim" role="presentation" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <h2 id={id} class="title-2">{title}</h2>
        {children}
      </div>
    </div>
  );
}
