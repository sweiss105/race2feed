/**
 * The arithmetic of a single-elimination bracket. Stages are counted from the final: 1 is the final stage
 * (the final and the third-place race), 2 the semi-finals, 3 the quarter-finals, and so on.
 */

/** Number of knockout stages for a bracket of n teams: 1 for 2, 2 for 3–4, 3 for 5–8, 4 for 9–16, …; 0 for fewer than 2. */
export function knockoutStages(n: number): number {
  let stages = 0;
  for (let size = 1; size < n; size *= 2) stages++;
  return stages;
}

/**
 * Seed positions of a full draw of `size` (a power of two), top to bottom: [1, 8, 4, 5, 2, 7, 3, 6] for 8.
 * Neighbours meet in the first stage, so 1 meets the lowest seed, and seeds 1 and 2 can only meet in the final.
 */
export function seedSlots(size: number): number[] {
  let slots = [1];
  while (slots.length < size) {
    const next = slots.length * 2;
    slots = slots.flatMap((seed) => [seed, next + 1 - seed]);
  }
  return slots;
}

/**
 * Stage name counted from the final: 1 → 'Final', 2 → 'Semi-final', 3 → 'Quarter-final', 4 → 'Round of 16',
 * anything earlier `Round ${stageFromStart}`, counted from the bracket's first stage.
 */
export function stageName(stagesFromFinal: number, stageFromStart: number): string {
  return ['Final', 'Semi-final', 'Quarter-final', 'Round of 16'][stagesFromFinal - 1] ?? `Round ${stageFromStart}`;
}

/**
 * What a race of a stage is called: the stage name and the race's number among the `count` races of the stage
 * ("Semi-final 1", "Quarter-final 3"; "Round of 16 · 5" and "Round 1 · 5", where the name already ends in a
 * number). A stage with one race has no number.
 */
export function knockoutRaceName(stagesFromFinal: number, stageFromStart: number, index: number, count: number): string {
  const name = stageName(stagesFromFinal, stageFromStart);
  if (count === 1) return name;
  return /\d$/.test(name) ? `${name} · ${index}` : `${name} ${index}`;
}

export interface KnockoutMatch {
  /** 1 = the final, 2 = a semi-final, … */
  stage: number;
  /** Place in the stage's column from the top, from 1. Match p is fed by matches 2p − 1 and 2p of the stage before it (stage + 1). */
  position: number;
  /**
   * The bracket's first stage only: the two seed numbers drawn here, top first; null for an empty slot, whose
   * opponent has a bye. Later stages (null) take the teams that come out of their two feeding matches.
   */
  seeds: [number | null, number | null] | null;
  /** The race's number among the stage's races, from 1 at the top; null when the match is a bye and has no race. */
  index: number | null;
}

/**
 * The draw of a bracket of n teams, one list of matches per stage, the first stage first and the final last.
 * Seeds are placed by seedSlots on the next power of two; a slot whose seed number is above n is empty, so the
 * top seeds have a bye: no race in the first stage, and first in line in the next. Only the first stage has byes.
 * The third-place race is not a match of the draw. Fewer than 2 teams: no stages.
 */
export function knockoutDraw(n: number): KnockoutMatch[][] {
  const stages = knockoutStages(n);
  if (stages === 0) return [];
  const slots = seedSlots(2 ** stages).map((seed) => (seed <= n ? seed : null));
  const draw: KnockoutMatch[][] = [];
  for (let stage = stages; stage >= 1; stage--) {
    let index = 0;
    draw.push(Array.from({ length: 2 ** (stage - 1) }, (_, i): KnockoutMatch => {
      const seeds: KnockoutMatch['seeds'] = stage === stages ? [slots[2 * i] ?? null, slots[2 * i + 1] ?? null] : null;
      const raced = !seeds || (seeds[0] !== null && seeds[1] !== null);
      return { stage, position: i + 1, seeds, index: raced ? ++index : null };
    }));
  }
  return draw;
}

/** Whether a bracket of n teams has a third-place race: it needs two semi-finals that are both raced. */
export const hasThirdPlace = (n: number): boolean => n >= 4;

/**
 * How many races a bracket of n teams has in `stage` (1 = the final stage, which counts the third-place race);
 * 0 when the bracket has no such stage. Every race has two teams.
 */
export function knockoutRaces(n: number, stage: number): number {
  const stages = knockoutStages(n);
  if (stage < 1 || stage > stages) return 0;
  const races = stage === stages ? n - 2 ** (stages - 1) : 2 ** (stage - 1);
  return races + (stage === 1 && hasThirdPlace(n) ? 1 : 0);
}
