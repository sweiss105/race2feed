import type { PublicView } from '../../lib/types';

/** Filled in by the brackets task. */
export function Brackets(_: { state: PublicView; teamId: string | null; storage: Storage }) {
  return <p class="secondary callout">Brackets appear after seeding.</p>;
}
