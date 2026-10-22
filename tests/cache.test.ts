import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../src/server/cache';
import { percentile, summarize } from '../src/server/metrics';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('TtlCache', () => {
  it('counts misses then hits', async () => {
    const c = clock();
    const cache = new TtlCache<string>(1000, 10, c.now);
    const load = vi.fn(async () => 'v');

    expect(await cache.getOrLoad('k', load)).toEqual({ value: 'v', status: 'MISS' });
    expect(await cache.getOrLoad('k', load)).toEqual({ value: 'v', status: 'HIT' });
    expect(await cache.getOrLoad('k', load)).toEqual({ value: 'v', status: 'HIT' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ hits: 2, misses: 1, hitRate: 2 / 3 });
  });

  it('expires entries after the TTL', async () => {
    const c = clock();
    const cache = new TtlCache<number>(1000, 10, c.now);
    let n = 0;
    const load = async () => ++n;

    await cache.getOrLoad('k', load);
    c.advance(999);
    expect((await cache.getOrLoad('k', load)).value).toBe(1);
    c.advance(2);
    expect(await cache.getOrLoad('k', load)).toEqual({ value: 2, status: 'MISS' });
  });

  it('serves an expired copy as STALE when the loader fails', async () => {
    const c = clock();
    const cache = new TtlCache<string>(1000, 10, c.now);
    await cache.getOrLoad('k', async () => 'old');
    c.advance(5000);

    const res = await cache.getOrLoad('k', async () => {
      throw new Error('offline');
    });
    expect(res).toEqual({ value: 'old', status: 'STALE' });
    expect(cache.stats().stale).toBe(1);
  });

  it('force skips a fresh copy, counts a miss and refills the cache', async () => {
    const c = clock();
    const cache = new TtlCache<number>(1000, 10, c.now);
    let n = 0;
    const load = async () => ++n;

    await cache.getOrLoad('k', load);
    expect(await cache.getOrLoad('k', load, { force: true })).toEqual({ value: 2, status: 'MISS' });
    expect(await cache.getOrLoad('k', load)).toEqual({ value: 2, status: 'HIT' }); // the forced load was stored
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 2 });
  });

  it('force still falls back to the saved copy as STALE when the loader fails', async () => {
    const cache = new TtlCache<string>(1000);
    await cache.getOrLoad('k', async () => 'old');
    const res = await cache.getOrLoad(
      'k',
      async () => {
        throw new Error('offline');
      },
      { force: true },
    );
    expect(res).toEqual({ value: 'old', status: 'STALE' });
  });

  it('rethrows when the loader fails and nothing is cached', async () => {
    const cache = new TtlCache<string>(1000);
    await expect(
      cache.getOrLoad('k', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
  });

  it('shares one upstream call between concurrent requests', async () => {
    const cache = new TtlCache<string>(1000);
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const a = cache.getOrLoad('k', load);
    const b = cache.getOrLoad('k', load);
    resolve('v');
    expect(await a).toEqual({ value: 'v', status: 'MISS' });
    expect(await b).toEqual({ value: 'v', status: 'HIT' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry beyond the cap', async () => {
    const cache = new TtlCache<string>(60_000, 2);
    await cache.getOrLoad('a', async () => 'A');
    await cache.getOrLoad('b', async () => 'B');
    await cache.getOrLoad('a', async () => 'A'); // touch a, so b is now oldest
    await cache.getOrLoad('c', async () => 'C');

    expect(cache.peek('a')).toBe('A');
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('c')).toBe('C');
    expect(cache.stats().size).toBe(2);
  });
});

describe('latency summary', () => {
  it('computes nearest-rank percentiles', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
    expect(summarize([3, 1, 2])).toEqual({ count: 3, p50: 2, p95: 3, mean: 2 });
  });
});
