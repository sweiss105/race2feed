import { useState } from 'preact/hooks';

/**
 * A switch that moves the instant it is tapped and stays there while the change is sent;
 * it settles to the server's value when the request finishes.
 */
export function Switch({ checked, label, disabled, onToggle }: {
  checked: boolean; label: string; disabled?: boolean; onToggle(next: boolean): Promise<unknown>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <label class="switch">
      <input type="checkbox" role="switch" checked={pending ?? checked} disabled={disabled || pending !== null}
        onChange={(e) => {
          const next = (e.target as HTMLInputElement).checked;
          setPending(next);
          void onToggle(next).finally(() => setPending(null));
        }} />
      <span class="callout">{label}</span>
    </label>
  );
}
