import { exports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

describe('worker', () => {
  it('answers health checks', async () => {
    const res = await exports.default.fetch('https://r2f.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('pages', () => {
  it('serves the built participant page at the site root', async () => {
    const res = await exports.default.fetch('https://r2f.test/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app">');
  });
  it('serves the projector page', async () => {
    const res = await exports.default.fetch('https://r2f.test/projector/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Projector');
  });
});
