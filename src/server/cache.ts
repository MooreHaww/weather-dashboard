// A small in-memory TTL cache with LRU eviction and hit/miss counters.
// Expired entries are kept (up to the size cap) so they can be served as a
// stale fallback when Open-Meteo is unreachable.

import type { CacheStatus } from '../shared/types';

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  stale: number;
  size: number;
  hitRate: number;
}

export interface CacheResult<V> {
  value: V;
  status: CacheStatus;
}

export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>();
  private inflight = new Map<string, Promise<V>>();
  private hits = 0;
  private misses = 0;
  private stale = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  /** Fresh value for key, or undefined. Does not touch the counters. */
  peek(key: string): V | undefined {
    const e = this.entries.get(key);
    return e && e.expiresAt > this.now() ? e.value : undefined;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  /**
   * Return a fresh cached value (HIT), or call `load` (MISS). Concurrent
   * misses for the same key share one upstream call; the followers count as
   * hits because they didn't cause a request. If `load` fails and an expired
   * copy exists, that copy is returned as STALE. With `force`, a cached copy
   * is ignored and `load` is called (a MISS); the STALE fallback still applies.
   */
  async getOrLoad(key: string, load: () => Promise<V>, opts: { force?: boolean } = {}): Promise<CacheResult<V>> {
    const entry = this.entries.get(key);
    if (!opts.force && entry && entry.expiresAt > this.now()) {
      this.hits++;
      this.entries.delete(key); // refresh LRU position
      this.entries.set(key, entry);
      return { value: entry.value, status: 'HIT' };
    }

    const pending = this.inflight.get(key);
    if (pending) {
      this.hits++;
      return { value: await pending, status: 'HIT' };
    }

    this.misses++;
    const p = load();
    this.inflight.set(key, p);
    try {
      const value = await p;
      this.set(key, value);
      return { value, status: 'MISS' };
    } catch (err) {
      if (entry) {
        this.stale++;
        return { value: entry.value, status: 'STALE' };
      }
      throw err;
    } finally {
      this.inflight.delete(key);
    }
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      stale: this.stale,
      size: this.entries.size,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}
