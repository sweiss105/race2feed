import { describe, it, expect } from 'vitest';
import { needsSnapshot } from '../../src/core/broadcast';
import { lockedFour } from './helpers';

describe('needsSnapshot', () => {
  const at = (phase: 'open' | 'running' | 'finished', current = 3) => ({ ...lockedFour(), round: { current, phase, startedAt: 1, finishedAt: null } });
  it('sends a snapshot when a race starts', () => {
    expect(needsSnapshot({ type: 'startRace' }, at('open'))).toBe(true);
  });
  it('sends a snapshot for corrections while reviewing a finished round', () => {
    expect(needsSnapshot({ type: 'setResult', round: 3, teamId: 't', set: { kind: 'clear' } }, at('finished'))).toBe(true);
    expect(needsSnapshot({ type: 'addPenalty', round: 3, teamId: 't', reasonId: 'sealed' }, at('finished'))).toBe(true);
  });
  it('uses the small update for live changes in the running round', () => {
    expect(needsSnapshot({ type: 'setResult', round: 3, teamId: 't', set: { kind: 'clear' } }, at('running'))).toBe(false);
    expect(needsSnapshot({ type: 'tapFinish', teamId: 't', atServerMs: 1, clientTapId: 'c' }, at('running'))).toBe(false);
  });
  it('sends a snapshot after a penalty decision', () => {
    expect(needsSnapshot({ type: 'decidePenalty', tapId: 'x', decision: 'reject' }, at('finished'))).toBe(true);
    expect(needsSnapshot({ type: 'notePenalty', tapId: 'x', reasonId: 'sealed' }, at('finished'))).toBe(false);
  });

  it('sends a snapshot for corrections to earlier rounds', () => {
    expect(needsSnapshot({ type: 'setResult', round: 2, teamId: 't', set: { kind: 'clear' } }, at('running'))).toBe(true);
  });
});
