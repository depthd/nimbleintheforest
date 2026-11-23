"""Exercise the ancestry guard in a temporary repository."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


guard = Path(__file__).resolve().parents[1] / 'scripts' / 'repo-check.mjs'
env = dict(os.environ, GIT_AUTHOR_NAME='Fixture', GIT_COMMITTER_NAME='Fixture',
           GIT_AUTHOR_EMAIL='fixture@example.invalid', GIT_COMMITTER_EMAIL='fixture@example.invalid')

with tempfile.TemporaryDirectory() as tmp:
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=tmp, env=env, text=True).strip()

    def check(ok, *args):
        result = subprocess.run(['node', str(guard), *args], cwd=tmp, capture_output=True, text=True)
        assert (result.returncode == 0) == ok, (args, result.stdout, result.stderr)

    git('init', '-b', 'main')
    git('commit', '--allow-empty', '-m', 'foundation')
    base = git('rev-parse', 'HEAD')
    git('commit', '--allow-empty', '-m', 'gameplay')
    main = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', main)
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    config = Path(tmp) / '.coord' / 'repository.json'
    config.parent.mkdir()
    config.write_text(json.dumps({'required_ancestors': [main]}))

    check(True)
    check(False, '--candidate', base)
    check(False, '--candidate', base, '--base', base)
    check(False, '--base', 'missing')
    git('commit', '--allow-empty', '-m', 'candidate')
    check(True, '--base', main)
    check(False, '--base', 'HEAD', '--candidate', main)
    print('PASS: default branch, explicit base, required history, missing revision and candidate ancestry')
