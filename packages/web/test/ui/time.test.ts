import { describe, it, expect } from 'vitest';
import { timeText } from '../../src/ui/Time';

describe('timeText with a pending penalty', () => {
  it('adds the pending label to a plain time', () => {
    expect(timeText({ status: 'finished', officialMs: 221_200, penaltiesMs: 0, penaltyPending: true })).toBe('3:41.20 · pending: under review');
  });
  it('adds the pending label after approved penalties', () => {
    expect(timeText({ status: 'finished', officialMs: 226_200, penaltiesMs: 5000, penaltyNotes: ['Bag not sealed'], penaltyPending: true })).toBe('3:46.20 (incl. +5s · Bag not sealed) · pending: under review');
  });
  it('shortens the label for the projector', () => {
    expect(timeText({ status: 'finished', officialMs: 221_200, penaltiesMs: 0, penaltyPending: true }, { short: true })).toBe('3:41.20 · under review');
  });
  it('shows a plain time when nothing is pending', () => {
    expect(timeText({ status: 'finished', officialMs: 221_200, penaltiesMs: 0 })).toBe('3:41.20');
  });
});
