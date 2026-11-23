import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { Brackets } from '../../src/pages/participant/Brackets';
import { MemoryStorage } from '../lib/fakes';
import { previousEventDone, viewOf } from '../support/state';

describe('Brackets', () => {
  beforeEach(() => cleanup());
  const e = previousEventDone();
  const state = viewOf(e);
  const riverbend = e.setup.teams.find((t) => t.name === 'Riverbend Middle School')!.id;

  it('highlights the remembered team', () => {
    render(<Brackets state={state} teamId={riverbend} storage={new MemoryStorage()} />);
    const mine = document.querySelectorAll('[aria-current="true"]');
    expect(mine.length).toBeGreaterThan(0);
    for (const el of mine) expect(el.textContent).toContain('Riverbend');
  });

  it('remembers the diagram view', () => {
    const storage = new MemoryStorage();
    render(<Brackets state={state} teamId={null} storage={storage} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
    expect(storage.getItem('r2f.bracketView')).toBe('diagram');
    expect(document.querySelector('.bracket-diagram')).toBeTruthy();
  });
});
