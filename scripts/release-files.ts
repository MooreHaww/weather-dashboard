// Lists the three files to upload to a GitHub release and checks they agree:
//   npm run release-files   (also runs at the end of `npm run dist`)
//
// - latest.yml's version equals package.json's version
// - latest.yml names an installer that exists in release/ (no spaces in the name)
// - the installer's .blockmap exists and the sha512 in latest.yml matches the file
// Exits with code 1 if anything is wrong.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ReleaseCheck {
  /** Absolute paths of the files to upload: installer, blockmap, latest.yml. */
  files: string[];
  problems: string[];
}

/** The fields of electron-builder's latest.yml we need (a flat file; no YAML library needed). */
export function parseLatestYml(text: string): { version?: string; path?: string; url?: string; sha512?: string } {
  const field = (re: RegExp) => text.match(re)?.[1]?.trim().replace(/^'(.*)'$/, '$1');
  return {
    version: field(/^version:\s*(.+)$/m),
    path: field(/^path:\s*(.+)$/m),
    url: field(/^\s+-\s+url:\s*(.+)$/m),
    sha512: field(/^sha512:\s*(.+)$/m),
  };
}

function sha512(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject);
  });
}

export async function checkReleaseFiles(dir: string, version: string): Promise<ReleaseCheck> {
  const problems: string[] = [];
  const yml = path.resolve(dir, 'latest.yml');
  if (!existsSync(yml)) return { files: [], problems: [`${yml} is missing (run npm run dist)`] };

  const latest = parseLatestYml(readFileSync(yml, 'utf8'));
  if (latest.version !== version) problems.push(`latest.yml version is ${latest.version}, package.json is ${version}`);
  if (!latest.path) return { files: [], problems: [...problems, 'latest.yml has no path'] };
  if (latest.url !== latest.path) problems.push(`latest.yml url (${latest.url}) differs from path (${latest.path})`);
  if (/\s/.test(latest.path)) problems.push(`installer name has spaces: "${latest.path}" (GitHub would rename it)`);
  if (!latest.path.includes(version)) problems.push(`installer name ${latest.path} does not contain ${version}`);

  const installer = path.resolve(dir, latest.path);
  const blockmap = `${installer}.blockmap`;
  if (!existsSync(installer)) problems.push(`installer named in latest.yml is missing: ${installer}`);
  else if ((await sha512(installer)) !== latest.sha512) problems.push(`sha512 in latest.yml does not match ${latest.path}`);
  if (!existsSync(blockmap)) problems.push(`blockmap is missing: ${blockmap}`);

  return { files: [installer, blockmap, yml], problems };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  void checkReleaseFiles(path.join(root, 'release'), version).then(({ files, problems }) => {
    if (problems.length) {
      console.error(`Release files for v${version} are NOT ready:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      process.exit(1);
    }
    console.log(`Upload these 3 files to the GitHub release tagged v${version}:\n${files.map((f) => `  ${f}`).join('\n')}`);
  });
}
