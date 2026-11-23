import { stationOfTable } from '@race2feed/engine';
import { done, fail, type CommandResult, type Ctx, type LiveEvent, type Tap, type TapCommand } from './model';
import { buildProgress, derive, teamsInRound } from './results';

/** Clock skew allowed between a synced tablet and the server. */
const FUTURE_TOLERANCE_MS = 2000;

export function handleTaps(e: LiveEvent, cmd: TapCommand, ctx: Ctx): CommandResult {
  const ok = (event: LiveEvent) => done(event, cmd, ctx);
  const current = e.round.current;

  /** A resend of a tap this device already delivered (from its offline queue). */
  const isResend = (clientTapId: string) =>
    e.taps.some((t) => t.clientTapId === clientTapId && t.deviceId === ctx.actor.deviceId);

  const refereeCheck = (teamId: string): CommandResult | null => {
    if (e.round.phase !== 'running') return fail('round_not_running', 'No race is running.');
    const entrant = teamsInRound(derive(e), current).find((t) => t.teamId === teamId);
    if (!entrant || stationOfTable(entrant.table) !== ctx.actor.station) {
      return fail('not_your_team', 'That team is not at your tables this round.');
    }
    return null;
  };

  const newTap = (t: Omit<Tap, 'id' | 'createdAt' | 'removedAt' | 'deviceId'>): Tap => ({
    ...t,
    id: ctx.newId(),
    ...(ctx.actor.deviceId ? { deviceId: ctx.actor.deviceId } : {}),
    createdAt: ctx.now,
    removedAt: null,
  });

  /** Corrections to an earlier round need confirmation once later rounds have results. */
  const correctionCheck = (round: number, confirm: boolean | undefined): CommandResult | null => {
    if (round < 1 || round > current) return fail('invalid', `Round ${round} has not been raced.`);
    if (round === current || confirm) return null;
    const later = new Set<number>();
    for (const f of [...e.taps, ...e.overrides]) if (f.round > round) later.add(f.round);
    if (!later.size) return null;
    return fail('unlock_required', 'Later rounds already have results; confirm to change this round.', {
      laterRounds: [...later].sort((a, b) => a - b),
    });
  };

  const inRound = (round: number, teamId: string) =>
    teamsInRound(derive(e), round).some((t) => t.teamId === teamId);

  switch (cmd.type) {
    case 'tapFinish': {
      if (isResend(cmd.clientTapId)) return ok(e);
      const denied = refereeCheck(cmd.teamId);
      if (denied) return denied;
      const startedAt = e.round.startedAt!;
      if (cmd.atServerMs < startedAt || cmd.atServerMs > ctx.now + FUTURE_TOLERANCE_MS) {
        return fail('bad_timestamp', 'The tap time is outside the race; check the tablet clock.');
      }
      if (buildProgress(e).results[current]?.[cmd.teamId]) return fail('already_finished', 'That team already has a result.');
      const tap = newTap({
        clientTapId: cmd.clientTapId, kind: 'finish', round: current, teamId: cmd.teamId,
        elapsedMs: cmd.atServerMs - startedAt, source: 'referee',
      });
      return ok({ ...e, taps: [...e.taps, tap] });
    }
    case 'tapPenalty': {
      if (isResend(cmd.clientTapId)) return ok(e);
      const denied = refereeCheck(cmd.teamId);
      if (denied) return denied;
      if (!e.settings.penaltiesEnabled) return fail('penalties_disabled', 'Time penalties are switched off.');
      const tap = newTap({
        clientTapId: cmd.clientTapId, kind: 'penalty', round: current, teamId: cmd.teamId,
        amountMs: e.settings.penaltyMs, source: 'referee',
      });
      return ok({ ...e, taps: [...e.taps, tap] });
    }
    case 'undoTap': {
      const tap = e.taps.find((t) => t.id === cmd.tapId);
      if (!tap || tap.removedAt !== null) return fail('not_found', 'That tap no longer exists.');
      if (!ctx.actor.deviceId || tap.deviceId !== ctx.actor.deviceId) return fail('not_your_tap', 'Only the tablet that made a tap can undo it.');
      if (e.round.phase !== 'running' || tap.round !== current) return fail('round_not_running', 'The race is over; ask race control.');
      if (ctx.now - tap.createdAt > e.settings.undoWindowMs) return fail('undo_expired', 'Too late to undo; ask race control.');
      return ok({ ...e, taps: e.taps.map((t) => (t.id === tap.id ? { ...t, removedAt: ctx.now } : t)) });
    }
    case 'setResult': {
      const denied = correctionCheck(cmd.round, cmd.confirmUnlock);
      if (denied) return denied;
      if (!inRound(cmd.round, cmd.teamId)) return fail('not_in_round', 'That team is not in this round.');
      if (cmd.set.kind === 'time' && (!Number.isInteger(cmd.set.rawMs) || cmd.set.rawMs < 0)) {
        return fail('invalid', 'Time must be a whole, positive number of ms.');
      }
      return ok({ ...e, overrides: [...e.overrides, { round: cmd.round, teamId: cmd.teamId, at: ctx.now, set: cmd.set }] });
    }
    case 'addPenalty': {
      const denied = correctionCheck(cmd.round, cmd.confirmUnlock);
      if (denied) return denied;
      if (!inRound(cmd.round, cmd.teamId)) return fail('not_in_round', 'That team is not in this round.');
      const tap = newTap({ kind: 'penalty', round: cmd.round, teamId: cmd.teamId, amountMs: e.settings.penaltyMs, source: 'control' });
      return ok({ ...e, taps: [...e.taps, tap] });
    }
    case 'removePenalty': {
      const tap = e.taps.find((t) => t.id === cmd.tapId && t.kind === 'penalty');
      if (!tap || tap.removedAt !== null) return fail('not_found', 'That penalty no longer exists.');
      const denied = correctionCheck(tap.round, cmd.confirmUnlock);
      if (denied) return denied;
      return ok({ ...e, taps: e.taps.map((t) => (t.id === tap.id ? { ...t, removedAt: ctx.now } : t)) });
    }
    case 'setPenaltiesEnabled':
      return ok({ ...e, settings: { ...e.settings, penaltiesEnabled: cmd.enabled } });
  }
}
