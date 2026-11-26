import { hasThirdPlace, knockoutDraw, knockoutRaceName, stageName, type KnockoutMatch } from '@race2feed/engine';
import type { PublicEntrant, PublicRace, PublicView } from './types';
import { teamName } from './selectors';

export interface BracketEntrant { teamId: string; name: string; table: number | null; officialMs: number | null; penaltiesMs: number; place: number | null; status: string }
export interface BracketRace { id: string; label: string; entrants: BracketEntrant[] }
export interface BracketStage { title: string; races: BracketRace[] }
export interface BracketCard { bracketId: string; tierName: string; tierIndex: number; firstSeed: number; size: number; stages: BracketStage[] }
export interface CategoryCards { categoryId: string; categoryName: string; brackets: BracketCard[] }

/** What a bracket round is called in a bracket's list of stages. */
const STAGE: Record<string, string> = { heats: 'First race', placement: 'Placement', finals: 'Final' };

/** Brackets per category, each as its stages: first race, placement, final places; in finals only, the one final. */
export function buildBracketCards(state: PublicView): CategoryCards[] {
  return state.categories.map((c) => ({
    categoryId: c.id,
    categoryName: c.name,
    brackets: state.brackets
      .filter((b) => b.categoryId === c.id)
      .sort((a, b) => a.tierIndex - b.tierIndex)
      .map((b) => {
        const stages: BracketStage[] = [];
        for (const r of state.rounds) {
          const races = r.races.filter((race) => race.bracketId === b.id);
          if (!races.length) continue;
          stages.push({
            title: `Round ${r.round} · ${STAGE[r.kind] ?? 'Placement'}`,
            races: races.map((race) => ({
              id: race.id,
              label: race.label.split(' · ').at(-1) ?? race.label,
              entrants: race.entrants.map((x) => ({
                teamId: x.teamId, name: teamName(state, x.teamId), table: x.table,
                officialMs: x.officialMs, penaltiesMs: x.penaltiesMs, place: x.place, status: x.status,
              })),
            })),
          });
        }
        const places = (state.standings[c.id] ?? []).slice(b.firstSeed - 1, b.firstSeed - 1 + b.size);
        // In finals only the one race is the result: its finishing order is the final places.
        if (state.format.brackets !== 'finals' && places.some((id) => id !== null)) {
          stages.push({
            title: 'Final places',
            races: [{
              id: `${b.id}:places`,
              label: 'Final places',
              entrants: places.flatMap((id, i) => (id === null ? [] : [{
                teamId: id, name: teamName(state, id), table: null, officialMs: null, penaltiesMs: 0, place: i + 1, status: 'finished',
              }])),
            }],
          });
        }
        return { bracketId: b.id, tierName: b.tierName, tierIndex: b.tierIndex, firstSeed: b.firstSeed, size: b.size, stages };
      }),
  }));
}

export interface BracketDiagram { columns: { title: string; groups: BracketRace[] }[] }

/** Classic bracket layout: one column per stage, races stacked within it. */
export function buildBracketDiagram(card: BracketCard): BracketDiagram {
  return { columns: card.stages.map((s) => ({ title: s.title, groups: s.races })) };
}

/** One side of a knockout match: a team, a bye (nobody was drawn here), or a team not known yet. */
export interface TreeSlot {
  kind: 'team' | 'bye' | 'pending';
  teamId: string | null;
  /** The team's name, "Bye", or where the team comes from: "Winner of Quarter-final 2", "Loser of Semi-final 1". */
  text: string;
  /** The team's seed in its category; null without a team. */
  seed: number | null;
  /** The team's entry in the race once the race's round is opened: table, time, status. */
  entrant: PublicEntrant | null;
  /** The team won this race: every team in it has a result and this one is first. */
  winner: boolean;
}
export interface TreeMatch {
  key: string;
  /** "Semi-final 1", "Final", "Third place"; empty for a bye, which is no race. */
  name: string;
  bye: boolean;
  slots: [TreeSlot, TreeSlot];
}
export interface TreeColumn { title: string; matches: TreeMatch[] }
export interface BracketTree {
  bracketId: string; categoryId: string; categoryName: string; tierName: string; tierIndex: number; size: number;
  /** One column per stage, the first stage first and the final last; match p of a column is fed by 2p − 1 and 2p of the column before. */
  columns: TreeColumn[];
  /** The third-place race, drawn under the final; null when the bracket has none. */
  third: TreeMatch | null;
  /** A bracket of one team: no race, it wins by default. */
  solo: TreeSlot | null;
}

export const SOLO_NOTE = 'No race: the only team in this bracket';

/**
 * Knockout brackets as trees, in category then tier order; [] in any other format and until the brackets are
 * drawn and published (bracketMembers). A slot holds a team when the draw puts it there (the first stage, and a
 * team that had a bye) or when the race's round has been opened with that team in it; until then it says where
 * its team will come from. Entrants are matched to the side of the match whose part of the draw they came through.
 */
export function buildBracketTrees(state: PublicView): BracketTree[] {
  const members = state.bracketMembers;
  if (state.format.brackets !== 'knockout' || !members) return [];
  return state.categories.flatMap((c) => state.brackets
    .filter((b) => b.categoryId === c.id && (members[b.id]?.length ?? 0) > 0)
    .sort((a, b) => a.tierIndex - b.tierIndex)
    .map((b): BracketTree => {
      const seeded = members[b.id]!;
      const base = { bracketId: b.id, categoryId: c.id, categoryName: c.name, tierName: b.tierName, tierIndex: b.tierIndex, size: seeded.length };
      const seedOf = (teamId: string) => b.firstSeed + seeded.indexOf(teamId);
      const team = (teamId: string, race: PublicRace | undefined): TreeSlot => {
        const entrant = race?.entrants.find((x) => x.teamId === teamId) ?? null;
        const decided = Boolean(race && race.entrants.length > 1 && race.entrants.every((x) => x.status !== 'pending'));
        return { kind: 'team', teamId, text: teamName(state, teamId), seed: seedOf(teamId), entrant, winner: decided && entrant?.place === 1 };
      };
      const waiting = (kind: 'bye' | 'pending', text: string): TreeSlot => ({ kind, teamId: null, text, seed: null, entrant: null, winner: false });
      if (seeded.length < 2) return { ...base, columns: [], third: null, solo: team(seeded[0]!, undefined) };

      const races = state.rounds.flatMap((r) => r.races).filter((race) => race.bracketId === b.id);
      const raceEnding = (suffix: string) => races.find((race) => race.id.endsWith(`:${suffix}`));
      const draw = knockoutDraw(seeded.length);
      const stages = draw.length;
      const column = (m: KnockoutMatch) => draw[stages - m.stage]!;
      const feeders = (m: KnockoutMatch) => (draw[stages - m.stage - 1] ?? []).slice(2 * m.position - 2, 2 * m.position);
      const nameOf = (m: KnockoutMatch) =>
        (m.index === null ? '' : knockoutRaceName(m.stage, stages - m.stage + 1, m.index, column(m).filter((x) => x.index !== null).length));
      /** Every team drawn into the part of the tree that ends in this match. */
      const drawn = (m: KnockoutMatch): string[] =>
        (m.seeds ? m.seeds.flatMap((s) => (s === null ? [] : [seeded[s - 1]!])) : feeders(m).flatMap(drawn));
      const raceOf = (m: KnockoutMatch) => (m.index === null ? undefined : raceEnding(m.stage === 1 ? 'final' : `ko${m.stage}-${m.index}`));
      /** The side of `race` fed by match `f`: the team that came through f, or what it is waiting for. */
      const fed = (f: KnockoutMatch, race: PublicRace | undefined, wording: 'Winner' | 'Loser'): TreeSlot => {
        const through = race?.entrants.find((x) => drawn(f).includes(x.teamId));
        if (through) return team(through.teamId, race);
        if (f.index === null) return wording === 'Winner' ? team(drawn(f)[0]!, race) : waiting('bye', 'Bye');
        return waiting('pending', `${wording} of ${nameOf(f)}`);
      };
      const match = (m: KnockoutMatch): TreeMatch => {
        const race = raceOf(m);
        const slots = m.seeds
          ? m.seeds.map((s) => (s === null ? waiting('bye', 'Bye') : team(seeded[s - 1]!, race)))
          : feeders(m).map((f) => fed(f, race, 'Winner'));
        return { key: `${b.id}:${m.stage}-${m.position}`, name: nameOf(m), bye: m.index === null, slots: slots as [TreeSlot, TreeSlot] };
      };
      const columns = draw.map((col): TreeColumn => {
        const name = stageName(col[0]!.stage, stages - col[0]!.stage + 1);
        // "Quarter-finals" when the stage has several races; one race beside byes is the "Quarter-final".
        return { title: col.filter((m) => m.index !== null).length > 1 && /final$/.test(name) ? `${name}s` : name, matches: col.map(match) };
      });
      const final = draw[stages - 1]![0]!;
      const third: TreeMatch | null = hasThirdPlace(seeded.length)
        ? { key: `${b.id}:third`, name: 'Third place', bye: false, slots: feeders(final).map((f) => fed(f, raceEnding('third'), 'Loser')) as [TreeSlot, TreeSlot] }
        : null;
      return { ...base, columns, third, solo: null };
    }));
}

/** The match a team is in now or next: its match in the latest stage it has reached (the third-place race for a semi-final loser). */
export function matchOfTeam(tree: BracketTree, teamId: string | null): TreeMatch | null {
  if (teamId === null) return null;
  const has = (m: TreeMatch) => m.slots.some((x) => x.teamId === teamId);
  if (tree.third && has(tree.third)) return tree.third;
  for (let i = tree.columns.length - 1; i >= 0; i--) {
    const found = tree.columns[i]!.matches.find(has);
    if (found) return found;
  }
  return null;
}
