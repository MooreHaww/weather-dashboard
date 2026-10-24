import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkReleaseFiles, parseLatestYml } from '../scripts/release-files';

let dir: string;
const body = Buffer.from('fake installer');
const sha = createHash('sha512').update(body).digest('base64');

function yml(version: string, name: string, sha512 = sha): string {
  return `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${body.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-10-24T00:00:00.000Z'\n`;
}

async function release(version: string, name: string, opts: { blockmap?: boolean; sha512?: string } = {}) {
  await writeFile(path.join(dir, 'latest.yml'), yml(version, name, opts.sha512));
  await writeFile(path.join(dir, name), body);
  if (opts.blockmap !== false) await writeFile(path.join(dir, `${name}.blockmap`), 'x');
}

beforeEach(async () => (dir = await mkdtemp(path.join(tmpdir(), 'wd-release-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('release files check', () => {
  it('reads latest.yml', () => {
    expect(parseLatestYml(yml('1.4.0', 'Weather-Dashboard-Setup-1.4.0.exe'))).toEqual({
      version: '1.4.0',
      path: 'Weather-Dashboard-Setup-1.4.0.exe',
      url: 'Weather-Dashboard-Setup-1.4.0.exe',
      sha512: sha,
    });
  });

  it('passes and lists installer, blockmap and latest.yml', async () => {
    await release('1.4.0', 'Weather-Dashboard-Setup-1.4.0.exe');
    const { files, problems } = await checkReleaseFiles(dir, '1.4.0');
    expect(problems).toEqual([]);
    expect(files.map((f) => path.basename(f))).toEqual([
      'Weather-Dashboard-Setup-1.4.0.exe',
      'Weather-Dashboard-Setup-1.4.0.exe.blockmap',
      'latest.yml',
    ]);
  });

  it('fails when latest.yml is for another version', async () => {
    await release('1.3.0', 'Weather-Dashboard-Setup-1.3.0.exe');
    const { problems } = await checkReleaseFiles(dir, '1.4.0');
    expect(problems.join('\n')).toMatch(/version is 1\.3\.0, package\.json is 1\.4\.0/);
  });

  it('fails when the name in latest.yml is not the installer in the folder (the old spaced name)', async () => {
    await writeFile(path.join(dir, 'latest.yml'), yml('1.4.0', 'Weather-Dashboard-Setup-1.4.0.exe'));
    await writeFile(path.join(dir, 'Weather Dashboard Setup 1.4.0.exe'), body);
    const { problems } = await checkReleaseFiles(dir, '1.4.0');
    expect(problems.join('\n')).toMatch(/installer named in latest\.yml is missing/);
  });

  it('fails on spaces, a missing blockmap or a wrong sha512', async () => {
    await release('1.4.0', 'Weather Dashboard Setup 1.4.0.exe', { blockmap: false, sha512: 'bad' });
    const text = (await checkReleaseFiles(dir, '1.4.0')).problems.join('\n');
    expect(text).toMatch(/has spaces/);
    expect(text).toMatch(/blockmap is missing/);
    expect(text).toMatch(/sha512 .* does not match/);
  });

  it('fails when latest.yml is missing', async () => {
    expect((await checkReleaseFiles(dir, '1.4.0')).problems[0]).toMatch(/latest\.yml is missing/);
  });
});
