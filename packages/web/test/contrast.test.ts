// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Every value a variable takes across the light, dark and projector blocks. */
const valuesOf = (name: string) => [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))].map((m) => m[1]!);

describe('button colours', () => {
  it('white text on the accent fill meets WCAG AA (4.5:1) in every theme', () => {
    const fills = valuesOf('--accent-fill');
    expect(fills.length).toBeGreaterThanOrEqual(2);
    for (const fill of fills) expect(contrast(fill, '#FFFFFF'), fill).toBeGreaterThanOrEqual(4.5);
  });
});
