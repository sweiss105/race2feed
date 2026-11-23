import type { Actor, Ctx, LiveEvent, CommandResult } from '../../src/core/model';
import { newEvent } from '../../src/core/model';

export const admin: Actor = { role: 'admin', label: 'admin' };
export const control: Actor = { role: 'control', label: 'control' };
export const companion: Actor = { role: 'companion', label: 'companion' };
export const referee = (station: number, deviceId = `dev${station}`): Actor =>
  ({ role: 'referee', label: `ref ${station}`, station, deviceId });

let n = 0;
export const ctx = (actor: Actor = admin, now = 1_000_000): Ctx => ({ actor, now, newId: () => `id${++n}` });

export function ok(r: CommandResult): LiveEvent {
  if (!r.ok) throw new Error(`${r.code}: ${r.message} ${JSON.stringify(r.detail ?? '')}`);
  return r.event;
}

export function csvFor(counts: Record<string, number>): string {
  const lines = ['team,category'];
  for (const [cat, count] of Object.entries(counts)) {
    for (let i = 1; i <= count; i++) lines.push(`${cat} ${i},${cat}`);
  }
  return lines.join('\n');
}

export const blank = (tables = 26): LiveEvent => newEvent('ev1', 'Test', '2026-12-01', tables);
