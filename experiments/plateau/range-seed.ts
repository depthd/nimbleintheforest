import { hashString, Rng } from '../../src/core/rng';

const input = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('seed');
export const rangeSeed = input && /^\d{1,10}$/.test(input) && Number(input) <= 0xffffffff ? Number(input) : 42;
export const stream = (name: string) => new Rng(rangeSeed ^ hashString(name));
