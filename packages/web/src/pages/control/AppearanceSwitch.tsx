import { useState } from 'preact/hooks';
import { getTheme, setTheme, type Theme } from '../../lib/theme';

const THEMES: [Theme, string][] = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];

/**
 * Light or dark console for this browser only; stored locally, never sent to the server.
 * Pinned to the bottom right of the console so it is at hand on every section.
 */
export function AppearanceSwitch() {
  const [theme, choose] = useState<Theme>(() => getTheme());
  return (
    <div class="segmented appearance-switch" role="radiogroup" aria-label="Appearance"
      title="Appearance, for this browser only. Phones, referee devices and the projector are not affected.">
      {THEMES.map(([t, label]) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t ? 'true' : 'false'} aria-selected={theme === t ? 'true' : 'false'}
          onClick={() => { setTheme(t); choose(t); }}>{label}</button>
      ))}
    </div>
  );
}
