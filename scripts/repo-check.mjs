// Check that a candidate preserves both its integration base and the game's history.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(ref) {
  return git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
}

try {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      candidate: { type: 'string', default: 'HEAD' },
      config: { type: 'string', default: '.coord/repository.json' },
    },
  });
  const config = JSON.parse(readFileSync(values.config, 'utf8'));
  const candidate = commit(values.candidate);
  const base = commit(values.base ?? `origin/${config.integration_branch}`);
  for (const ref of [base, ...config.required_ancestors]) {
    const required = commit(ref);
    try {
      git('merge-base', '--is-ancestor', required, candidate);
    } catch {
      throw new Error(`Candidate ${candidate} does not contain ${required}`);
    }
  }
  console.log(`PASS: ${candidate} includes base ${base} and required history.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
