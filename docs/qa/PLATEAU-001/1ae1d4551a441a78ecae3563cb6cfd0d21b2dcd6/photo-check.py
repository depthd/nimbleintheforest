from pathlib import Path
import json,hashlib
from PIL import Image
p=Path(__file__).resolve().parent;qa=p.parent
pairs=[]
for view in ['one','two','three']:
 pairs.append(('reference-'+view,qa/'9462b0b498b89ec0932f536140378b6c821cc6aa'/f'{view}-F.png',p/f'reference-{view}-reference.png'))
 for mode in ['angular','stepped','arcs']:pairs.append((mode+'-'+view,qa/'ffa4079e8707073bf573240c43e3622cb6de8ad5'/f'{mode}-{view}-F.png',p/f'{mode}-{view}-before.png'))
results=[]
for name,a,b in pairs:
 ia=Image.open(a).convert('RGBA');ib=Image.open(b).convert('RGBA');same=ia.size==ib.size and ia.tobytes()==ib.tobytes()
 results.append({'case':name,'pngBytesIdentical':a.read_bytes()==b.read_bytes(),'pixelsIdentical':same,'oldPixelSha256':hashlib.sha256(ia.tobytes()).hexdigest(),'newPixelSha256':hashlib.sha256(ib.tobytes()).hexdigest()})
(p/'photo-check.json').write_text(json.dumps({'checks':results,'allPixelsIdentical':all(q['pixelsIdentical']for q in results),'allPngBytesIdentical':all(q['pngBytesIdentical']for q in results)},indent=2)+'\n')
print(json.dumps(results,indent=2))
assert all(q['pixelsIdentical']for q in results),'Reference and before captures must stay unchanged'
