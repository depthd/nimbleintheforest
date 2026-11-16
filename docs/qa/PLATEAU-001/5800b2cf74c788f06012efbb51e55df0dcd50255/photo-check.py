from pathlib import Path
from PIL import Image
import json,hashlib
import numpy as np
p=Path(__file__).resolve().parent
old=p.parent/'9462b0b498b89ec0932f536140378b6c821cc6aa'
checks=[]
for view in ['one','two','three']:
 a=old/f'{view}-F.png';b=p/f'reference-{view}.png'
 ia=Image.open(a).convert('RGBA');ib=Image.open(b).convert('RGBA')
 delta=np.abs(np.asarray(ia,dtype=np.int16)-np.asarray(ib,dtype=np.int16))
 checks.append({'maxChannelDifference':int(delta.max()),'changedPixels':int(np.any(delta>0,axis=2).sum()),'meanChannelDifference':float(delta.mean()),'view':view,'samePngBytes':a.read_bytes()==b.read_bytes(),'samePixels':ia.size==ib.size and ia.tobytes()==ib.tobytes(),'pixelSha256':hashlib.sha256(ib.tobytes()).hexdigest()})
report={'result':'PASS' if all(c['samePixels']and c['samePngBytes']for c in checks)else'PIXEL_DIFF','checks':checks}
(p/'photo-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert all(c['maxChannelDifference']<=1 for c in checks),'Difference exceeds one 8-bit channel level'
