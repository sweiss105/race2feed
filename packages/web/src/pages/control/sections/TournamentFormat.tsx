import { useEffect, useState } from 'preact/hooks';
import type { BracketFormat, SeedingRankRule } from '@race2feed/engine';
import type { ControlView } from '../../../lib/types';
import { useRunner } from '../runner';
import {
  BRACKET_FORMAT, BRACKETS_MISMATCH, CUSTOM, CUSTOM_NOTE, LOCKED_NOTE, PANEL_INTRO, PRESETS, RANK_CHANGED,
  SEEDING_RANK, SEEDING_RUNS, SEEDING_RUNS_HELP, SEEDING_RUNS_LABEL, bracketsMismatch, formatSummary, presetOf, rankUnavailable,
  type Format,
} from '../../../lib/formatCopy';

const KEY = 'setFormat';

/**
 * How the event runs: presets and the three settings behind them, each option with its explanation in plain
 * sight, and what the current setup adds up to. Every change is one setFormat command.
 */
export function TournamentFormat({ view }: { view: ControlView }) {
  const runner = useRunner();
  const locked = view.setupLocked;
  const stored = view.format;
  // The choice shows the moment it is pressed; it settles on the server's format when that arrives.
  const [pending, setPending] = useState<Partial<Format>>({});
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setPending({}), [stored.seedingRuns, stored.seedingRank, stored.brackets]);
  const format: Format = { ...stored, ...pending };
  const preset = presetOf(format);

  const change = async (patch: Partial<Format>, said: string | null = null) => {
    if (locked || runner.busy(KEY)) return;
    if ((Object.keys(patch) as (keyof Format)[]).every((k) => format[k] === patch[k])) return;
    setPending((p) => ({ ...p, ...patch }));
    setNote(said);
    const ack = await runner.run({ type: KEY, format: patch }, KEY);
    if (!ack?.ok) { setPending({}); setNote(null); }
  };

  /** A round count the current rank rule cannot work with also switches the rule, in the same command. */
  const chooseRuns = (seedingRuns: 1 | 2 | 3) => (rankUnavailable(format.seedingRank, seedingRuns)
    ? change({ seedingRuns, seedingRank: 'total' }, RANK_CHANGED)
    : change({ seedingRuns }));

  const setup = { ...view.setup, format };
  const summary = formatSummary(setup);

  return (
    <section class="panel card format-panel" aria-labelledby="tournament-format">
      <div class="format-head">
        <h3 id="tournament-format" class="title-2">Tournament format</h3>
        <p class="callout secondary">{PANEL_INTRO}</p>
        {locked && <p class="format-locked callout">{LOCKED_NOTE}</p>}
      </div>

      <Group name="Preset" count={4} aside={preset === 'custom' && <><span class="format-tag current">{CUSTOM}</span><span class="format-aside">{CUSTOM_NOTE}</span></>}>
        {PRESETS.map((p) => (
          <Option key={p.id} id={`format-preset-${p.id}`} name={p.name} help={p.blurb} checked={preset === p.id}
            disabled={locked} onChoose={() => void change(p.format)} />
        ))}
      </Group>

      <Group name="Seeding rounds" count={3}>
        {SEEDING_RUNS.map((n) => (
          <Option key={n} id={`format-runs-${n}`} name={SEEDING_RUNS_LABEL[n]} help={SEEDING_RUNS_HELP[n]} checked={format.seedingRuns === n}
            disabled={locked} onChoose={() => void chooseRuns(n)} />
        ))}
      </Group>

      <Group name="Seeding rank" count={3} note={note}>
        {(Object.keys(SEEDING_RANK) as SeedingRankRule[]).map((rule) => {
          const why = rankUnavailable(rule, format.seedingRuns);
          return (
            <Option key={rule} id={`format-rank-${rule}`} name={SEEDING_RANK[rule].label} help={SEEDING_RANK[rule].help} checked={format.seedingRank === rule}
              tag={why} disabled={locked || why !== null} onChoose={() => void change({ seedingRank: rule })} />
          );
        })}
      </Group>

      <Group name="Bracket format" count={4}>
        {(Object.keys(BRACKET_FORMAT) as BracketFormat[]).map((b) => (
          <Option key={b} id={`format-brackets-${b}`} name={BRACKET_FORMAT[b].label} help={BRACKET_FORMAT[b].help} checked={format.brackets === b}
            disabled={locked} onChoose={() => void change({ brackets: b })} />
        ))}
      </Group>

      {bracketsMismatch(setup) && <p class="format-warning callout" role="alert">{BRACKETS_MISMATCH}</p>}
      {runner.error(KEY) && <p class="err">{runner.error(KEY)}</p>}

      <div class="format-summary">
        <span class="format-group-title">This setup makes</span>
        {/* Counts stand out; a sentence about what is still needed reads as a sentence. */}
        <span class={`format-summary-value${/^\d/.test(summary) ? '' : ' needs'}`} data-testid="format-summary" aria-live="polite">{summary}</span>
      </div>
    </section>
  );
}

/** One setting: its heading and its choices side by side (count: how many, for the layout). */
function Group({ name, count, aside, note, children }: {
  name: string; count: 3 | 4; aside?: preact.ComponentChildren; note?: string | null; children: preact.ComponentChildren;
}) {
  return (
    <div class="format-group">
      <div class="format-group-head">
        <h4 class="format-group-title">{name}</h4>
        {aside}
      </div>
      {note && <p class="format-note callout" role="status">{note}</p>}
      <div class={`format-options of-${count}`} role="radiogroup" aria-label={name}>{children}</div>
    </div>
  );
}

/** One choice: its name, a tag when it cannot be chosen (and why), and its explanation, always visible. */
function Option({ id, name, help, tag, checked, disabled, onChoose }: {
  id: string; name: string; help: string; tag?: string | null; checked: boolean; disabled: boolean; onChoose(): void;
}) {
  return (
    <button type="button" role="radio" class="format-option" aria-checked={checked ? 'true' : 'false'}
      aria-labelledby={`${id}-name`} aria-describedby={`${id}-help${tag ? ` ${id}-tag` : ''}`} disabled={disabled} onClick={onChoose}>
      <span class="format-radio" aria-hidden="true" />
      <span class="format-option-body">
        <span class="format-option-head">
          <span id={`${id}-name`} class="format-option-name">{name}</span>
          {tag && <span id={`${id}-tag`} class="format-tag">{tag}</span>}
        </span>
        <span id={`${id}-help`} class="format-option-help">{help}</span>
      </span>
    </button>
  );
}
