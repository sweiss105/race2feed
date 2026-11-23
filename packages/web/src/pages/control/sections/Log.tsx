import type { ControlView } from '../../../lib/types';

interface Entry { at: number; actor: string; action: string; detail: string }

export function Log({ view }: { view: ControlView }) {
  const entries = view.audit as Entry[];
  return (
    <>
      <h2 class="title-1">Log</h2>
      <p class="secondary callout">The latest 50 changes, newest first.</p>
      <table class="table panel">
        <thead><tr><th>Time</th><th>Who</th><th>What</th></tr></thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td class="tabular footnote">{new Date(e.at).toLocaleTimeString()}</td>
              <td class="callout">{e.actor}</td>
              <td><span class="headline">{e.action}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
