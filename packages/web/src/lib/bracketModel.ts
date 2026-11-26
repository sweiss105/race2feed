import type { PublicView } from './types';
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
