// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const dist = resolve(__dirname, '../dist');

describe('build output', () => {
  it('has one HTML entry per page', () => {
    for (const page of ['index.html', 'projector/index.html', 'ref/index.html', 'control/index.html', 'emergency/index.html', '404.html']) {
      expect(existsSync(resolve(dist, page)), page).toBe(true);
    }
  });

  it('keeps the participant page JavaScript under 60 KB gzipped', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    const total = scripts.reduce((sum, s) => sum + gzipSync(readFileSync(resolve(dist, `.${s}`))).length, 0);
    expect(total).toBeLessThanOrEqual(61_440);
  });
});
