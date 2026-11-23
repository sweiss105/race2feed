import { useEffect, useState } from 'preact/hooks';
import './control.css';
import type { Ack, ControlView } from '../../lib/types';
import type { Me } from '../../lib/api';
import type { LiveStatus } from '../../lib/live';
import { StatusDot } from '../../ui/StatusDot';
import { RunnerProvider } from './runner';
import { Race } from './sections/Race';
import { Teams } from './sections/Teams';
import { Setup } from './sections/Setup';
import { Devices } from './sections/Devices';
import { Settings } from './sections/Settings';
import { Events } from './sections/Events';
import { Log } from './sections/Log';

export type Section = 'race' | 'teams' | 'setup' | 'devices' | 'settings' | 'events' | 'log';

const LABELS: Record<Section, string> = {
  race: 'Race', teams: 'Teams', setup: 'Setup', devices: 'Devices', settings: 'Settings', events: 'Events', log: 'Log',
};

export function sectionsFor(role: Me['role']): Section[] {
  return role === 'admin' ? ['race', 'teams', 'setup', 'devices', 'settings', 'events', 'log'] : ['race', 'teams', 'devices', 'log'];
}

export interface ConsoleProps {
  me: Me;
  view: ControlView | null;
  send(cmd: object): Promise<Ack>;
  serverNow(): number;
  status: LiveStatus;
  onSignOut?(): void;
}

export function ConsolePage(props: ConsoleProps) {
  const sections = sectionsFor(props.me.role);
  const fromHash = () => {
    const h = (typeof location !== 'undefined' ? location.hash.slice(1) : '') as Section;
    return sections.includes(h) ? h : 'race';
  };
  const [section, setSection] = useState<Section>(fromHash);
  useEffect(() => {
    const on = () => setSection(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  });

  return (
    <RunnerProvider send={props.send}>
      <div class="console">
        <nav class="sidebar" aria-label="Sections">
          <div class="brand"><div class="headline">Race to Feed</div><StatusDot status={props.status} /></div>
          {sections.map((s) => (
            <a key={s} href={`#${s}`} aria-current={s === section ? 'page' : undefined} onClick={() => setSection(s)}>{LABELS[s]}</a>
          ))}
          <div class="spacer" />
          {props.onSignOut && <a href="#" onClick={(e) => { e.preventDefault(); props.onSignOut!(); }}>Sign out</a>}
        </nav>
        <main class="content">
          <div class="page">
            {!props.view && section !== 'events' && section !== 'settings'
              ? <p class="secondary callout">No event is active. {props.me.role === 'admin' ? 'Create or activate one under Events.' : 'Ask the admin to activate the event.'}</p>
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
    case 'teams': return <Teams view={p.view!} role={p.me.role} />;
    case 'setup': return <Setup view={p.view!} />;
    case 'devices': return <Devices view={p.view!} />;
    case 'settings': return <Settings view={p.view} />;
    case 'events': return <Events />;
    case 'log': return <Log view={p.view!} />;
  }
}
