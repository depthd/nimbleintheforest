import json,sys
from pathlib import Path
import numpy as np
from PIL import Image
p=Path(sys.argv[1]); variants='ABCDEF'; report={'method':'Rec.709 mean Y after sRGB decoding of the ACES-rendered PNG. Relative displayed luminance, not illuminance. Fixed exposure 1.05. Each view uses the exact same pixel sets for all six variants, the intersection of world-space owner-ID ROIs. Sky/UI/cornice/old pillows excluded.','roi':{'centerAngleRad':.7,'maxAbsAngleDeltaRad':.13,'roof':'owners plateau/strip or new snow inner/outer; normalized plateau radius 0.90–0.98','wall':'wall/rock owners; radius 1.005–1.115 and world y from stone edge height minus30 to minus8m'},'views':{}}
for view in ['one','two','three']:
 ids={v:np.array(Image.open(p/f'mask-{view}-{v}.png'))[:,:,:3]for v in variants}
 assert np.array_equal(ids['A'],ids['C'])and np.array_equal(ids['A'],ids['D'])
 assert np.array_equal(ids['E'],ids['F'])
 masks={name:np.logical_and.reduce([(x[:,:,channel]>250)&(np.delete(x,channel,axis=2).max(axis=2)<4)for x in ids.values()])for name,channel in [('wall',0),('roof',1)]}
 details={}
 maskpic=np.zeros_like(ids['A'])
 for name,m in masks.items():
  assert int(m.sum())>500,(view,name,int(m.sum()))
  yy,xx=np.nonzero(m); details[name]={'pixels':int(m.sum()),'bboxXYXY':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())]}; maskpic[m]=[255,0,0]if name=='wall'else[0,255,0]
 Image.fromarray(maskpic).save(p/f'common-roi-{view}.png')
 values={}
 for v in variants:
  rgb=np.array(Image.open(p/f'{view}-{v}.png'))[:,:,:3]/255
  linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
  y=linear@np.array([.2126,.7152,.0722]); means={name:float(y[m].mean())for name,m in masks.items()}
  values[v]={'meanY':means,'wallToRoof':means['wall']/means['roof'],'roofToWall':means['roof']/means['wall']}
 report['views'][view]={'regions':details,'maskIsolation':{'A=C=D':True,'E=F':True},'variants':values,'DwallRelativeToA':values['D']['meanY']['wall']/values['A']['meanY']['wall'],'DroofRelativeToA':values['D']['meanY']['roof']/values['A']['meanY']['roof']}
(p/'brightness.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['view,variant,wall_mean_Y,roof_mean_Y,wall_to_roof,roof_to_wall']
for view,d in report['views'].items():
 for v,q in d['variants'].items():lines.append(f"{view},{v},{q['meanY']['wall']:.8f},{q['meanY']['roof']:.8f},{q['wallToRoof']:.8f},{q['roofToWall']:.4f}")
(p/'brightness.csv').write_text('\n'.join(lines)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
