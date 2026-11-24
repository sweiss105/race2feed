import { useState } from 'preact/hooks';
import { formatMs } from '@race2feed/engine';
import type { ControlView } from '../../../lib/types';
import { raceAction, type RaceAction } from '../../../lib/raceAction';
import { useNow } from '../../../lib/useNow';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { useRunner } from '../runner';

const COMMAND: Record<Exclude<RaceAction['kind'], 'showChampion'>, string> = {
  open: 'openNextRound', start: 'startRace', finish: 'finishRace', hideChampion: 'hideChampion',
};

/** Round title, clock, a status line saying what the room waits for, and one large button for the next step. */
export function RaceHeader({ view, serverNow }: { view: ControlView; serverNow(): number }) {
  const runner = useRunner();
  const { round } = view;
  const running = round.phase === 'running' && round.startedAt !== null;
  const now = useNow(serverNow, running);
  const elapsed = running ? Math.max(0, now - round.startedAt!) : 0;
  const action = raceAction(view, now);
  const [sheet, setSheet] = useState(false);
  const command = action.kind === 'showChampion' ? 'showChampion' : COMMAND[action.kind];

  const press = () => {
    if (action.kind === 'showChampion') setSheet(true);
    else void runner.run({ type: command });
  };

  return (
    <>
      <header class="race-head">
        <div class="race-info">
          <div class="left">
            <h2 class="title-1">{round.current ? `Round ${round.current}` : 'Not started'}</h2>
            <span class={`pill ${round.phase}`}>{round.phase}</span>
            {running && <span class="race-clock" aria-label="Race clock">{formatMs(elapsed, 'seconds')}</span>}
          </div>
          <p class="race-status" role="status">{action.status}</p>
        </div>
        <Button kind={action.kind === 'hideChampion' ? 'secondary' : 'primary'} class={`race-action${action.pulse ? ' pulse' : ''}`}
          disabled={!action.enabled} busy={runner.busy(command)} onClick={press}>{action.label}</Button>
      </header>
      {['openNextRound', 'startRace', 'finishRace', 'hideChampion'].map((k) => runner.error(k) && <p key={k} class="err" role="alert">{runner.error(k)}</p>)}
      {sheet && <ChampionSheet view={view} onClose={() => setSheet(false)} />}
    </>
  );
}

function ChampionSheet({ view, onClose }: { view: ControlView; onClose(): void }) {
  const runner = useRunner();
  const [bags, setBags] = useState(view.bagTotal ?? '');
  return (
    <Sheet title="Show the champion" onClose={onClose}>
      <p class="callout secondary">The champion and the bag count appear on the projector and every phone.</p>
      <label class="field">
        <span class="footnote secondary">Bags of food packed</span>
        <input class="input" inputMode="numeric" aria-label="Bags of food packed" placeholder="e.g. 9,816" value={bags}
          onInput={(e) => setBags((e.target as HTMLInputElement).value)} />
      </label>
      {runner.error('showChampion') && <p class="err">{runner.error('showChampion')}</p>}
      <div class="sheet-actions">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={runner.busy('showChampion')} onClick={async () => {
          const ack = await runner.run({ type: 'showChampion', bagTotal: bags });
          if (ack?.ok) onClose();
        }}>Show</Button>
      </div>
    </Sheet>
  );
}
