import type { ButtonHTMLAttributes } from 'preact';

type Kind = 'primary' | 'secondary' | 'destructive' | 'plain';

export function Button({ kind = 'primary', busy = false, class: cls, disabled, children, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class'> & { kind?: Kind; busy?: boolean; class?: string }) {
  return (
    <button
      type="button"
      {...rest}
      class={`btn btn-${kind}${cls ? ` ${cls}` : ''}`}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
    >
      {children}
    </button>
  );
}
