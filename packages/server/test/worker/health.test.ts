import { exports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

describe('worker', () => {
  it('answers health checks', async () => {
    const res = await exports.default.fetch('https://r2f.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('placeholder page', () => {
  it('is served by the worker at the site root', async () => {
    const res = await exports.default.fetch('https://r2f.test/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Race to Feed');
  });
});
