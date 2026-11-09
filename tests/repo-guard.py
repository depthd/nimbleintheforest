"""Isolated behavioral checks for the prototype; no game checkout mutations."""
import json, os, pathlib, subprocess, tempfile
script=pathlib.Path(__file__).resolve().parent.parent/'scripts/repo-check.mjs'
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp)
 env=dict(os.environ,GIT_AUTHOR_NAME='Guard fixture',GIT_AUTHOR_EMAIL='fixture@example.invalid',GIT_COMMITTER_NAME='Guard fixture',GIT_COMMITTER_EMAIL='fixture@example.invalid')
 def git(*args): return subprocess.check_output(['git',*args],cwd=p,env=env,stderr=subprocess.DEVNULL,text=True).strip()
 git('init','-b','main');(p/'allowed.txt').write_text('base');git('add','.');git('commit','-m','base');base=git('rev-parse','HEAD')
 (p/'.coord').mkdir();config=p/'.coord/config.json';task=p/'.coord/task.json'
 config.write_text(json.dumps({'integration_branch':'main','required_ancestors':[base]}))
 card={'status':'developing','branch':'task/T1-test','base_sha':base,'allowed_paths':['allowed.txt']}
 task.write_text(json.dumps(card));(p/'.gitignore').write_text('.coord/\n');git('add','.gitignore');git('commit','-m','fixture config exclusion')
 git('checkout','-b',card['branch']);(p/'allowed.txt').write_text('changed');git('add','.');git('commit','-m','allowed change')
 def check(name,ok):
  r=subprocess.run(['node',str(script),'--config',str(config),'--base',base,'--task',str(task)],cwd=p,text=True,capture_output=True)
  assert (r.returncode==0)==ok,(name,r.stdout,r.stderr)
  print('PASS',name)
 # Include the fixture-only ignore file in scope; task scope covers committed files.
 card['allowed_paths'].append('.gitignore');task.write_text(json.dumps(card));check('valid task',True)
 card['branch']='task/OTHER';task.write_text(json.dumps(card));check('wrong branch blocked',False)
 card['branch']='task/T1-test';card['status']='draft';task.write_text(json.dumps(card));check('inactive task blocked',False)
 card['status']='developing';task.write_text(json.dumps(card));(p/'allowed.txt').write_text('dirty');check('uncommitted work blocked',False)
 git('restore','allowed.txt');(p/'outside.txt').write_text('unexpected');git('add','.');git('commit','-m','outside scope');check('outside scope blocked',False)
