import { DurableObject } from 'cloudflare:workers';
import type { Env } from './worker';

export class Hub extends DurableObject<Env> {}
