import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { ScreenLinks } from '../../src/pages/control/sections/Setup';

describe('screen links', () => {
  afterEach(cleanup);
  it('lists every screen with its full address, including the transparent projector', () => {
    render(<ScreenLinks origin="https://example.test" />);
    const value = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value;
    expect(value('Participants link')).toBe('https://example.test/');
    expect(value('Projector link')).toBe('https://example.test/projector/');
    expect(value('Projector, transparent link')).toBe('https://example.test/projector/?bg=transparent');
    expect(value('Referee link')).toBe('https://example.test/ref/');
    expect(value('Race control link')).toBe('https://example.test/control/');
  });

  it('copies a link and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ScreenLinks origin="https://example.test" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Projector, transparent link' }));
    expect(writeText).toHaveBeenCalledWith('https://example.test/projector/?bg=transparent');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy Projector, transparent link' }).textContent).toBe('Copied'));
  });
});
