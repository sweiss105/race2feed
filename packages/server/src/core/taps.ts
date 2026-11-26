import { done, fail, type CommandResult, type Ctx, type LiveEvent, type Tap, type TapCommand } from './model';
import { buildProgress, derive, teamsInRound } from './results';
import { checkCorrection } from './corrections';
import { reasonsOf, reviewOf } from './reasons';
import { tablesFor } from './rotation';

/** Clock skew allowed between a synced tablet and the server. */
const FUTURE_TOLERANCE_MS = 2000;

export function handleTaps(e: LiveEvent, cmd: TapCommand, ctx: Ctx): CommandResult {
  const ok = (event: LiveEvent) => done(event, cmd, ctx);
  const current = e.round.current;

  /**
   * A resend of a tap this device already delivered for this team and kind (from its offline queue), in any
   * round and whatever became of the tap since (undone, removed, rejected): it must never make a second tap.
   */
  const isResend = (clientTapId: string, teamId: string, kind: Tap['kind']) =>
    e.taps.some((t) => t.clientTapId === clientTapId && t.deviceId === ctx.actor.deviceId
      && t.teamId === teamId && t.kind === kind);
  const validId = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 100;
  /** The round the tablet made the tap in; older tablet pages don't send one. */
  const validTapRound = (round: unknown) => round === undefined || (Number.isInteger(round) && (round as number) >= 1);
  /** A tap made in another round than the current one (it arrived late) is refused, whatever the current round's state. */
  const roundOver = (round: number | undefined): CommandResult | null =>
    round === undefined || round === current ? null : fail('round_over', `That tap was for round ${round}, which is over.`);

  const refereeCheck = (teamId: string): CommandResult | null => {
    if (e.round.phase !== 'running') return fail('round_not_running', 'No race is running.');
    const entrant = teamsInRound(derive(e), current).find((t) => t.teamId === teamId);
    if (!entrant || !tablesFor(e, ctx.actor, current).includes(entrant.table)) {
      return fail('not_your_team', 'That team is not at your tables this round.');
    }
    return null;
  };

  const newTap = (t: Omit<Tap, 'id' | 'createdAt' | 'removedAt' | 'deviceId'>): Tap => ({
    ...t,
    id: ctx.newId(),
    ...(ctx.actor.deviceId ? { deviceId: ctx.actor.deviceId } : {}),
    ...(t.source === 'control' ? { by: ctx.actor.label } : {}),
    createdAt: ctx.now,
    removedAt: null,
  });

  const validRound = (round: unknown) => Number.isInteger(round) && (round as number) >= 1 && (round as number) <= current;

  /** Applies a correction to an earlier round only if checkCorrection allows it. */
  const correct = (round: number, confirm: boolean | undefined, after: LiveEvent): CommandResult =>
    checkCorrection(e, after, round, confirm) ?? ok(after);

  const inRound = (round: number, teamId: string) =>
    teamsInRound(derive(e), round).some((t) => t.teamId === teamId);

  switch (cmd.type) {
    case 'tapFinish': {
      if (!validId(cmd.clientTapId) || !Number.isFinite(cmd.atServerMs) || !validTapRound(cmd.round)) return fail('invalid', 'A tap needs an id and a time.');
      if (isResend(cmd.clientTapId, cmd.teamId, 'finish')) return ok(e);
      const denied = roundOver(cmd.round) ?? refereeCheck(cmd.teamId);
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
      if (!validId(cmd.clientTapId) || !validTapRound(cmd.round)) return fail('invalid', 'A tap needs an id.');
      if (isResend(cmd.clientTapId, cmd.teamId, 'penalty')) return ok(e);
      const denied = roundOver(cmd.round) ?? refereeCheck(cmd.teamId);
      if (denied) return denied;
      if (!e.settings.penaltiesEnabled) return fail('penalties_disabled', 'Time penalties are switched off.');
      const tap = newTap({
        clientTapId: cmd.clientTapId, kind: 'penalty', round: current, teamId: cmd.teamId,
        amountMs: 0, source: 'referee',
      });
      tap.review = { status: 'pending' };
      return ok({ ...e, taps: [...e.taps, tap] });
    }
    case 'undoTap': {
      const tap = e.taps.find((t) => t.id === cmd.tapId);
      if (!tap || tap.removedAt !== null) return fail('not_found', 'That tap no longer exists.');
      if (!ctx.actor.deviceId || tap.deviceId !== ctx.actor.deviceId) return fail('not_your_tap', 'Only the tablet that made a tap can undo it.');
      if (e.round.phase !== 'running' || tap.round !== current) return fail('round_not_running', 'The race is over; ask race control.');
      if (ctx.now - tap.createdAt > e.settings.undoWindowMs) return fail('undo_expired', 'Too late to undo; ask race control.');
      if (tap.kind === 'penalty' && tap.review && tap.review.status !== 'pending') return fail('already_decided', 'Race control has already decided this penalty.');
      return ok({ ...e, taps: e.taps.map((t) => (t.id === tap.id ? { ...t, removedAt: ctx.now } : t)) });
    }
    case 'setResult': {
      if (!validRound(cmd.round)) return fail('invalid', `Round ${cmd.round} has not been raced.`);
      const s = cmd.set as { kind?: unknown; status?: unknown; rawMs?: unknown } | undefined;
      const validSet = s?.kind === 'clear'
        || (s?.kind === 'status' && (s.status === 'dnf' || s.status === 'dns'))
        || (s?.kind === 'time' && Number.isInteger(s.rawMs) && (s.rawMs as number) >= 0);
      if (!validSet) return fail('invalid', 'Result must be a time, DNF, DNS or clear.');
      if (!inRound(cmd.round, cmd.teamId)) return fail('not_in_round', 'That team is not in this round.');
      return correct(cmd.round, cmd.confirmUnlock,
        { ...e, overrides: [...e.overrides, { round: cmd.round, teamId: cmd.teamId, at: ctx.now, set: cmd.set, by: ctx.actor.label }] });
    }
    case 'addPenalty': {
      if (!validRound(cmd.round)) return fail('invalid', `Round ${cmd.round} has not been raced.`);
      if (!inRound(cmd.round, cmd.teamId)) return fail('not_in_round', 'That team is not in this round.');
      const reason = reasonsOf(e).find((r) => r.id === cmd.reasonId);
      if (!reason) return fail('invalid', 'Choose a reason from the penalty list.');
      const tap = newTap({
        kind: 'penalty', round: cmd.round, teamId: cmd.teamId,
        amountMs: reason.kind === 'time' ? reason.amountMs ?? 0 : 0, source: 'control',
      });
      tap.review = {
        status: 'approved', reasonId: reason.id, reasonName: reason.name, decidedAt: ctx.now,
        ...(reason.kind === 'dq' ? { dq: true } : {}),
      };
      return correct(cmd.round, cmd.confirmUnlock, { ...e, taps: [...e.taps, tap] });
    }
    case 'removePenalty': {
      const tap = e.taps.find((t) => t.id === cmd.tapId && t.kind === 'penalty');
      if (!tap || tap.removedAt !== null) return fail('not_found', 'That penalty no longer exists.');
      return correct(tap.round, cmd.confirmUnlock,
        { ...e, taps: e.taps.map((t) => (t.id === tap.id ? { ...t, removedAt: ctx.now, removedBy: ctx.actor.label } : t)) });
    }
    case 'setPenaltiesEnabled':
      return ok({ ...e, settings: { ...e.settings, penaltiesEnabled: cmd.enabled } });
    case 'notePenalty': {
      const tap = e.taps.find((t) => t.id === cmd.tapId && t.kind === 'penalty');
      if (!tap || tap.removedAt !== null) return fail('not_found', 'That penalty no longer exists.');
      if (!ctx.actor.deviceId || tap.deviceId !== ctx.actor.deviceId) return fail('not_your_tap', 'Only the tablet that gave the penalty can add its note.');
      if (reviewOf(tap).status !== 'pending') return fail('already_decided', 'Race control has already decided this penalty.');
      if (tap.round === current && e.round.phase === 'running' && !buildProgress(e).results[current]?.[tap.teamId]) {
        return fail('team_not_finished', 'Add the note once this team has finished.');
      }
      if (tap.round === current && e.round.phase !== 'finished' && e.round.phase !== 'running') {
        return fail('round_not_finished', 'Add notes once race control finishes the round.');
      }
      if (!reasonsOf(e).some((r) => r.id === cmd.reasonId)) return fail('invalid', 'Choose a reason from the list.');
      const note = typeof cmd.note === 'string' ? cmd.note.trim().slice(0, 200) : '';
      const review = { ...reviewOf(tap), refereeReasonId: cmd.reasonId, ...(note ? { refereeNote: note } : {}) };
      return ok({ ...e, taps: e.taps.map((t) => (t.id === tap.id ? { ...t, review } : t)) });
    }
    case 'decidePenalty': {
      const tap = e.taps.find((t) => t.id === cmd.tapId && t.kind === 'penalty');
      if (!tap) return fail('not_found', 'That penalty no longer exists.');
      const previous = reviewOf(tap);
      // A tap undone by its referee (removed while still pending) is gone, not rejected.
      if (tap.removedAt !== null && previous.status === 'pending') return fail('not_found', 'That penalty was undone.');
      let updated: Tap;
      if (cmd.decision === 'reject') {
        updated = { ...tap, removedAt: tap.removedAt ?? ctx.now, removedBy: ctx.actor.label, review: { ...previous, status: 'rejected', decidedAt: ctx.now, dq: false } };
      } else if (cmd.decision === 'approve') {
        const reason = reasonsOf(e).find((r) => r.id === cmd.reasonId);
        if (!reason) return fail('invalid', 'Choose a reason from the penalty list to approve.');
        const { removedBy: _restored, ...kept } = tap;
        updated = {
          ...kept,
          removedAt: null,
          amountMs: reason.kind === 'time' ? reason.amountMs ?? 0 : 0,
          review: { ...previous, status: 'approved', reasonId: reason.id, reasonName: reason.name, decidedAt: ctx.now, dq: reason.kind === 'dq' },
        };
      } else {
        return fail('invalid', 'Decision must be approve or reject.');
      }
      return correct(tap.round, cmd.confirmUnlock, { ...e, taps: e.taps.map((t) => (t.id === tap.id ? updated : t)) });
    }
  }
}
