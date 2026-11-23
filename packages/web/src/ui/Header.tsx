import type { ComponentChildren } from 'preact';

export function Header({ title, trailing }: { title: string; trailing?: ComponentChildren }) {
  return (
    <header class="header">
      <h1>{title}</h1>
      {trailing ? <div>{trailing}</div> : null}
    </header>
  );
}
