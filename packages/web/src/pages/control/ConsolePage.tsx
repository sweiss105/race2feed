import { useEffect, useState } from 'preact/hooks';
import './control.css';
import type { Ack, ControlView } from '../../lib/types';
import { CONTROL_API, type ApiBase, type Me } from '../../lib/api';
import type { LiveStatus } from '../../lib/live';
import { StatusDot } from '../../ui/StatusDot';
import { RunnerProvider } from './runner';
import { Race } from './sections/Race';
import { Teams } from './sections/Teams';
import { Setup } from './sections/Setup';
import { Devices } from './sections/Devices';
import { Settings } from './sections/Settings';
import { Log } from './sections/Log';
import { openWarnings } from './sections/Fairness';

export type Section = 'race' | 'teams' | 'setup' | 'devices' | 'settings' | 'log';

const LABELS: Record<Section, string> = {
  race: 'Race Control', teams: 'Teams', setup: 'Setup', devices: 'Referees', settings: 'Settings', log: 'Log',
};

/** Old links to sections that moved: Events now lives on Settings. */
const MOVED: Record<string, Section> = { events: 'settings' };

export function sectionsFor(_role: Me['role']): Section[] {
  return ['race', 'teams', 'setup', 'devices', 'settings', 'log'];
}

export interface ConsoleProps {
  me: Me;
  view: ControlView | null;
  send(cmd: object): Promise<Ack>;
  serverNow(): number;
  status: LiveStatus;
  /** Where lists and exports are fetched from; `/api/control` unless given. */
  api?: ApiBase;
  /** Sign out by going to this address (Cloudflare Access); otherwise `onSignOut` is called. */
  signOutHref?: string;
  onSignOut?(): void;
}

export function ConsolePage(props: ConsoleProps) {
  const sections = sectionsFor(props.me.role);
  const fromHash = () => {
    const raw = typeof location !== 'undefined' ? location.hash.slice(1) : '';
    const h = (MOVED[raw] ?? raw) as Section;
    return sections.includes(h) ? h : 'race';
  };
  const [section, setSection] = useState<Section>(fromHash);
  useEffect(() => {
    const on = () => setSection(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  });

  // Fairness warnings still open, shown beside "Race Control" from every section.
  const warnings = openWarnings(props.view);

  return (
    <RunnerProvider send={props.send}>
      <div class="console">
        <nav class="sidebar" aria-label="Sections">
          <div class="brand"><div class="headline" title="Packing Race Coordinator">PRC</div><StatusDot status={props.status} /></div>
          {sections.map((s) => (
            <a key={s} href={`#${s}`} aria-current={s === section ? 'page' : undefined} onClick={() => setSection(s)}>
              {LABELS[s]}
              {s === 'race' && warnings > 0 && <span class="count-badge" aria-label={`${warnings} fairness warning${warnings === 1 ? '' : 's'}`}>{warnings}</span>}
            </a>
          ))}
          <div class="spacer" />
          {props.signOutHref
            ? <a href={props.signOutHref}>Sign out</a>
            : props.onSignOut && <a href="#" onClick={(e) => { e.preventDefault(); props.onSignOut!(); }}>Sign out</a>}
        </nav>
        <main class="content">
          <div class="page">
            {!props.view && section !== 'settings'
              ? <p class="secondary callout">No event is active. Create or activate one under Settings.</p>
              : <SectionView section={section} {...props} />}
          </div>
        </main>
      </div>
    </RunnerProvider>
  );
}

function SectionView({ section, ...p }: ConsoleProps & { section: Section }) {
  switch (section) {
    case 'race': return <Race view={p.view!} serverNow={p.serverNow} />;
    case 'teams': return <Teams view={p.view!} />;
    case 'setup': return <Setup view={p.view!} />;
    case 'devices': return <Devices view={p.view!} />;
    case 'settings': return <Settings view={p.view} api={p.api ?? CONTROL_API} />;
    case 'log': return <Log view={p.view!} />;
  }
}
