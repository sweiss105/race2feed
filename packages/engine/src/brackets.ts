import type { BracketSpec, Category, EventInput, Team } from './types';

export const DEFAULT_TIERS = ['Gold', 'Silver', 'Bronze', 'Copper', 'Tin'];

const tierName = (i: number, names: string[]) => names[i] ?? `Tier ${i + 1}`;

/** Brackets of 4 by seed; 1–3 leftover teams fold into the last bracket. */
export function suggestBracketPlan(
  categories: Category[],
  teams: Team[],
  tierNames: string[] = DEFAULT_TIERS,
): BracketSpec[] {
  const plan: BracketSpec[] = [];
  for (const category of categories) {
    const n = teams.filter((t) => t.categoryId === category.id).length;
    if (n === 0) continue;
    const sizes = n < 4 ? [n] : Array.from({ length: Math.floor(n / 4) }, () => 4);
    sizes[sizes.length - 1]! += n < 4 ? 0 : n % 4;
    let firstSeed = 1;
    sizes.forEach((size, tierIndex) => {
      plan.push({
        id: `${category.id}:${tierIndex}`,
        categoryId: category.id,
        tierIndex,
        tierName: tierName(tierIndex, tierNames),
        firstSeed,
        size,
      });
      firstSeed += size;
    });
  }
  return plan;
}

export function validateBracketPlan(input: EventInput): string[] {
  const errors: string[] = [];
  for (const category of input.categories) {
    const n = input.teams.filter((t) => t.categoryId === category.id).length;
    const brackets = input.brackets
      .filter((b) => b.categoryId === category.id)
      .sort((a, b) => a.tierIndex - b.tierIndex);
    const total = brackets.reduce((sum, b) => sum + b.size, 0);
    if (total !== n) errors.push(`${category.name}: brackets hold ${total} teams but the category has ${n}`);
    let expected = 1;
    for (const b of brackets) {
      if (b.firstSeed !== expected) errors.push(`${category.name} ${b.tierName}: seeds must start at ${expected}`);
      expected = b.firstSeed + b.size;
      if (n >= 4 && (b.size < 4 || b.size > 7)) errors.push(`${category.name} ${b.tierName}: size must be 4–7`);
      if (b.size > input.tableCount) errors.push(`${category.name} ${b.tierName}: larger than the ${input.tableCount} tables`);
    }
  }
  if (input.grandChampionship) {
    const winners = new Set(input.brackets.map((b) => b.categoryId)).size;
    if (winners >= 2 && winners > input.tableCount) {
      errors.push(`Grand Championship: ${winners} category winners but only ${input.tableCount} tables`);
    }
  }
  return errors;
}

export function bracketSet(b: BracketSpec): 'upper' | 'lower' {
  return b.tierIndex <= 1 ? 'upper' : 'lower';
}

/** Outside-in pairing; with an odd count the middle seed joins the last pair. */
export function buildHeats<T>(seeded: T[]): T[][] {
  const n = seeded.length;
  if (n < 4) return [seeded];
  const heats: T[][] = [];
  for (let i = 0; i < Math.floor(n / 2); i++) heats.push([seeded[i]!, seeded[n - 1 - i]!]);
  if (n % 2 === 1) heats[heats.length - 1]!.push(seeded[Math.floor(n / 2)]!);
  return heats;
}

/** Heat winners race for the top places; everyone else races for the rest. */
export function buildPlacement<T>(rankedHeats: T[][]): { winners: T[]; others: T[] } {
  return {
    winners: rankedHeats.map((h) => h[0]!),
    others: rankedHeats.flatMap((h) => h.slice(1)),
  };
}
