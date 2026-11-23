import { exports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

describe('worker', () => {
  it('answers health checks', async () => {
    const res = await exports.default.fetch('https://r2f.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
