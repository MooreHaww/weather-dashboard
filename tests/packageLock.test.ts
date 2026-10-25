import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => JSON.parse(readFileSync(join(__dirname, '..', file), 'utf8')) as { version: string; packages: Record<string, { version: string }> };

describe('package-lock.json', () => {
  it('names the same version as package.json (it said 1.3.0 for a while)', () => {
    const { version } = read('package.json');
    const lock = read('package-lock.json');
    expect(lock.version).toBe(version);
    expect(lock.packages['']!.version).toBe(version);
  });
});
