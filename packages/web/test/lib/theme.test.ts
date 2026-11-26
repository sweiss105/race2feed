import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, getTheme, setTheme } from '../../src/lib/theme';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

const blocked: Storage = {
  length: 0,
  clear() { throw new Error('blocked'); },
  getItem() { throw new Error('blocked'); },
  key() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

describe('theme preference', () => {
  let storage: Storage;
  let root: HTMLElement;
  beforeEach(() => { storage = memoryStorage(); root = document.createElement('html'); });

  it('is automatic by default', () => {
    expect(getTheme(storage)).toBe('auto');
  });

  it('ignores a stored value it does not know', () => {
    storage.setItem('prc.theme', 'purple');
    expect(getTheme(storage)).toBe('auto');
  });

  it('dark stores dark and sets theme-dark', () => {
    root.classList.add('theme-light');
    setTheme('dark', storage, root);
    expect(storage.getItem('prc.theme')).toBe('dark');
    expect(getTheme(storage)).toBe('dark');
    expect(root.classList.contains('theme-dark')).toBe(true);
    expect(root.classList.contains('theme-light')).toBe(false);
  });

  it('light stores light and sets theme-light', () => {
    root.classList.add('theme-dark');
    setTheme('light', storage, root);
    expect(storage.getItem('prc.theme')).toBe('light');
    expect(root.classList.contains('theme-light')).toBe(true);
    expect(root.classList.contains('theme-dark')).toBe(false);
  });

  it('automatic clears both classes and reads back auto', () => {
    setTheme('dark', storage, root);
    setTheme('auto', storage, root);
    expect(getTheme(storage)).toBe('auto');
    expect(root.classList.contains('theme-dark')).toBe(false);
    expect(root.classList.contains('theme-light')).toBe(false);
  });

  it('applies the stored preference on load', () => {
    storage.setItem('prc.theme', 'dark');
    applyTheme(storage, root);
    expect(root.classList.contains('theme-dark')).toBe(true);
  });

  it('stays automatic when storage is blocked, and still applies a choice to the page', () => {
    expect(getTheme(blocked)).toBe('auto');
    expect(() => setTheme('dark', blocked, root)).not.toThrow();
    expect(root.classList.contains('theme-dark')).toBe(true);
    expect(() => applyTheme(blocked, root)).not.toThrow();
  });
});
