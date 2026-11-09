// Read-only guard. No packages required. Run from a checkout of the game.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const contains = (a, b) => { try { git('merge-base', '--is-ancestor', a, b); return true; } catch { return false; } };
try {
  const config = JSON.parse(readFileSync(option('--config') || '.coord/repository.json', 'utf8'));
  const candidate = git('rev-parse', '--verify', `${option('--candidate') || 'HEAD'}^{commit}`);
  const base = git('rev-parse', '--verify', `${option('--base') || `origin/${config.integration_branch}`}^{commit}`);
  const taskPath = option('--task');
  if (!contains(base, candidate)) throw Error(`Candidate lacks integration base ${base}. Integrate the current base; do not overwrite it.`);
  for (const sha of config.required_ancestors) {
    if (!contains(sha, candidate)) throw Error(`Candidate lacks required milestone ${sha}`);
  }
  if (taskPath) {
    const task = JSON.parse(readFileSync(taskPath, 'utf8'));
    if (!['assigned', 'developing', 'qa', 'review'].includes(task.status)) throw Error('Task is not active');
    if (git('branch', '--show-current') !== task.branch) throw Error(`Wrong branch; expected ${task.branch}`);
    if (task.branch === config.integration_branch || !task.branch.startsWith('task/')) throw Error('Task must use its own task/ branch');
    if (!/^[0-9a-f]{40}$/.test(task.base_sha)) throw Error('Task needs a full base SHA');
    if (!contains(task.base_sha, candidate)) throw Error('Task base is missing from candidate');
    if (!Array.isArray(task.allowed_paths) || !task.allowed_paths.length) throw Error('Task needs allowed_paths');
    const changed = git('diff', '--name-only', '--diff-filter=ACDMRTUXB', task.base_sha, candidate).split('\n').filter(Boolean);
    const outside = changed.filter(p => !task.allowed_paths.some(a => a.endsWith('/') ? p.startsWith(a) : p === a));
    if (outside.length) throw Error(`Changes outside task scope: ${outside.join(', ')}`);
    const dirty = git('status', '--porcelain');
    if (dirty) throw Error('Uncommitted files exist; scope check covers committed work only. Preserve and commit task changes first.');
  }
  console.log(JSON.stringify({ result: 'PASS', candidate, integration_base: base, milestones: config.required_ancestors, note: 'Ancestry/scope only. Build, behavior, QA and visual approval are separate.' }, null, 2));
} catch (e) { console.error(`BLOCKED: ${e.message}`); process.exitCode = 1; }
