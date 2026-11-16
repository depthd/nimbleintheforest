"""Explanation only. Reuse archived triangle-plane intersections; never run the scene."""
import hashlib,json,math,re,html,xml.etree.ElementTree as ET
from pathlib import Path
HERE=Path(__file__).resolve().parent
QA=HERE.parent
OLD='9462b0b498b89ec0932f536140378b6c821cc6aa'
NEW='ffa4079e8707073bf573240c43e3622cb6de8ad5'
NS='{http://www.w3.org/2000/svg}'

def read(name,path):
    raw=path.read_bytes();root=ET.fromstring(raw)
    paths={p.get('stroke'):p.get('d') for p in root.iter(NS+'path') if p.get('stroke') in ['#686f75','#3486c8']}
    filled=next((p.get('d')for p in root.iter(NS+'path')if p.get('fill')=='#c0e0f9'),'')
    def segments(d):
        nums=list(map(float,re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?',d)))
        assert len(nums)%4==0
        return [[((nums[i]-1370)/28,(490-nums[i+1])/28),((nums[i+2]-1370)/28,(490-nums[i+3])/28)]for i in range(0,len(nums),4)]
    rock=segments(paths['#686f75']);snow=segments(paths['#3486c8'])
    # Join the stone's saved segments. Closure is below the visible crop only.
    remaining=rock.copy();q=remaining.pop();chain=[*q]
    while remaining:
        found=False
        for i,(a,b) in enumerate(remaining):
            for p,other in [(a,b),(b,a)]:
                if math.dist(chain[-1],p)<.0005:chain.append(other);found=True;break
                if math.dist(chain[0],p)<.0005:chain.insert(0,other);found=True;break
            if found:remaining.pop(i);break
        if not found:break
    assert not remaining,'Stone chain must contain all archived stone segments'
    assert chain[0][1]<-7 and chain[-1][1]<-7,'Only close the stone fill outside the crop'
    allrock=[p for s in rock for p in s];allblue=[p for s in snow for p in s]
    edge=max(allrock,key=lambda p:p[0])
    maxx=max(p[0]for p in allblue);tip=[p[1]for p in allblue if abs(p[0]-maxx)<.001/28]
    return dict(name=name,path=str(path.relative_to(QA)),sha256=hashlib.sha256(raw).hexdigest(),rock=rock,snow=snow,chain=chain,paths=paths,filled=filled,edge=edge,straightAtTipM=max(tip)-min(tip))

def heights(segments,x):
    out=[]
    for (a,b) in segments:
        if min(a[0],b[0])-1e-9<=x<=max(a[0],b[0])+1e-9 and abs(a[0]-b[0])>1e-12:
            out.append(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]))
    return sorted(set(round(y,9)for y in out))

old=read('Эталон F',QA/OLD/'section-E.svg')
new=read('F на кромке «дуги»',QA/NEW/'arcs-section.svg')
for case in [old,new]:
    case['edgeTop']=max(heights(case['snow'],case['edge'][0]))
    case['edgeThicknessM']=case['edgeTop']-case['edge'][1]
    assert abs(case['edgeThicknessM']-2.5)<.002
    assert case['straightAtTipM']<.001,'No long straight outer face in either selected section'
rock6=max(heights(new['rock'],-6));bottom6=min(heights(new['snow'],-6))
assert bottom6-rock6>2,'The selected section must really show an air gap'
metrics=json.loads((QA/NEW/'arcs.json').read_text())
assert metrics['stats']['maxSupportLiftM']>4
(HERE/'figure-data.json').write_text(json.dumps({'inputs':[{k:c[k]for k in ['name','path','sha256','edge','edgeThicknessM','straightAtTipM']}for c in [old,new]],'sharedSourceSvgCoordinates':{'pixelsPerMetre':28,'stoneEdgeReferenceX':1370,'heightReferenceY':490},'commonPlotMetres':{'x':[-18,3],'height':[-7,4]},'airGapAtMinus6m':bottom6-rock6,'areaWideLiftFromExistingArcsJson':metrics['stats']['maxSupportLiftM'],'correction':'The selected arcs section has no long straight tip and no excess edge thickness. The gap is visible. Area-wide maximum must not be assigned to this section.','newSceneCaptures':False},ensure_ascii=False,indent=2)+'\n')

parts=[]
def add(s):parts.append(s)
def text(x,y,s,size=25,color='#253b49',weight='400',anchor='start'):
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{html.escape(s)}</text>')
def line(x1,y1,x2,y2,color='#253b49',width=2,dash=''):
    add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"'if dash else '')+'/>')
def arrow(x1,y1,x2,y2,color='#253b49'):
    line(x1,y1,x2,y2,color,2.2);a=math.atan2(y2-y1,x2-x1);p=[(x2-11*math.cos(a-.45),y2-11*math.sin(a-.45)),(x2,y2),(x2-11*math.cos(a+.45),y2-11*math.sin(a+.45))];add('<polyline points="'+' '.join(f'{x},{y}'for x,y in p)+f'" fill="none" stroke="{color}" stroke-width="2.2"/>')
def pathline(points,stroke,fill='none',width=2):
    add('<path d="M'+' L'.join(f'{x:.4f},{y:.4f}'for x,y in points)+(' Z'if fill!='none'else '')+f'" stroke="{stroke}" stroke-width="{width}" fill="{fill}"/>')

def plot(case,left,top,scale=33,xmin=-18,xmax=3,ymin=-7,ymax=4,ident='a',grid=True,oldGuide=False,air=False):
    w=(xmax-xmin)*scale;h=(ymax-ymin)*scale
    X=lambda x:left+(x-xmin)*scale;Y=lambda y:top+(ymax-y)*scale
    add(f'<clipPath id="clip-{ident}"><rect x="{left}" y="{top}" width="{w}" height="{h}"/></clipPath>')
    add(f'<g clip-path="url(#clip-{ident})">')
    if grid:
        for x in range(math.ceil(xmin),math.floor(xmax)+1):line(X(x),top,X(x),top+h,'#e4e9ec',1)
        for y in range(math.ceil(ymin),math.floor(ymax)+1):line(left,Y(y),left+w,Y(y),'#e4e9ec',1)
    pathline([(X(x),Y(y))for x,y in case['chain']],'none','#aeafb0',0)
    if air:
        xx=[-17.95+i*.05 for i in range(359)]
        intervals=[]
        for x in xx:
            r=heights(case['rock'],x);s=heights(case['snow'],x)
            if r and s and min(s)-max(r)>.03:intervals.append((x,max(r),min(s)))
        if intervals:pathline([(X(x),Y(b))for x,a,b in intervals]+[(X(x),Y(a))for x,a,b in intervals[::-1]],'none','#f8e2b3',0)
    k=scale/28;tx=left-xmin*scale-1370*k;ty=top+ymax*scale-490*k
    add(f'<g transform="translate({tx},{ty}) scale({k})">')
    if case['filled']:add(f'<path d="{case["filled"]}" fill="#c3e2f6" stroke="none"/>')
    add(f'<path d="{case["paths"]["#686f75"]}" fill="none" stroke="#696e73" stroke-width="{2.8/k}"/>')
    add(f'<path d="{case["paths"]["#3486c8"]}" fill="none" stroke="#2585be" stroke-width="{3.1/k}"/>')
    add('</g>')
    if oldGuide:
        for a,b in old['rock']:
            if a[0]<=.01 and b[0]<=.01 and a[1]>-7 and b[1]>-7:line(X(a[0]),Y(a[1]),X(b[0]),Y(b[1]),'#727a82',2,'7 5')
    add('</g>')
    if grid:
        for y in range(math.ceil(ymin),math.floor(ymax)+1):
            line(left-8,Y(y),left,Y(y),'#83929d',1.5)
            if y%2==0:text(left-16,Y(y)+7,f'{y} м',20,'#5b6b76',anchor='end')
        for x in [-15,-10,-5,0]:text(X(x),top+h+26,f'{x} м',20,'#5b6b76',anchor='middle')
        text(left,top+h+55,'Расстояние от прежнего края камня',21,'#5b6b76')
    return X,Y

add('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 1980" role="img" aria-labelledby="title desc">')
add('<title id="title">Почему прежний мягкий снег F изменился на кромке дуги</title><desc id="desc">Два сохранённых разреза реальной геометрии в одном масштабе. В эталоне снег касается камня. На выбранном разрезе дуг виден воздушный зазор; длинного прямого торца и лишней толщины края здесь нет. Ниже схемы построения и причины несовпадения.</desc>')
add('<rect width="1800" height="1980" fill="#fcfcfb"/><style>text{font-family:Arial,DejaVu Sans,sans-serif}line,path,polyline{stroke-linejoin:round;stroke-linecap:round}</style>')
text(55,65,'Почему снег стал выглядеть иначе',44,weight='700')
text(55,109,'Вверху — сохранённые разрезы настоящей геометрии. Внизу — объясняющие схемы.',25,'#526571')
line(55,140,1740,140,'#d1dbe0',1.5)
text(95,190,'Эталон F: мягкий край',31,weight='700')
text(975,190,'F на кромке «дуги»: тот же срез',31,weight='700')
text(95,227,'Снег лежит на камне',25,'#2585be')
text(975,227,'Под частью снега появился воздух',25,'#a05e11')
# Both coordinates share exactly the saved 28px/m reference, then the same 33px/m output scale.
X,Y=plot(old,105,278,ident='old')
NX,NY=plot(new,985,278,ident='new',air=True)
# Labels outside the plots, with true geometric targets.
text(110,260,'1 клетка = 1 м',19,'#647681')
text(990,260,'Тот же масштаб по обеим осям',19,'#647681')
text(170,345,'Снег',25,'#2585be',weight='700');arrow(244,351,X(-12),Y(max(heights(old['snow'],-12))))
text(280,540,'Камень',25,'#5d646a',weight='700')
text(638,251,'Плавный изгиб',23,'#2585be');arrow(716,258,X(1.6),Y(max(heights(old['snow'],1.6))))
text(1310,478,'Воздух',28,'#995700',weight='700');arrow(1435,478,NX(-2),NY((max(heights(new['rock'],-2))+min(heights(new['snow'],-2)))/2),'#a96e1b')
text(1260,550,'Снег и камень разошлись',22,'#995700')
for c,XX,YY in [(old,X,Y),(new,NX,NY)]:
    bx=XX(2.55);ya=YY(c['edgeTop']);yb=YY(c['edge'][1]);line(bx,ya,bx,yb,'#2585be',2);line(bx-6,ya,bx+6,ya,'#2585be',2);line(bx-6,yb,bx+6,yb,'#2585be',2);text(bx-12,(ya+yb)/2+6,'2,5 м',21,'#2585be',anchor='end')
text(95,747,'Длинного плоского торца здесь нет.',24)
text(975,747,'Длинного плоского торца на этом срезе тоже нет.',24)
text(95,781,'У края — заданные 2,5 м.',24)
text(975,781,'Лишней толщины у края здесь не обнаружено.',24)
text(975,815,'Снег не закрашен: его края не сошлись.',23,'#2585be')
line(55,853,1740,853,'#d1dbe0',1.5)
text(55,895,'Поправка к моему прошлому объяснению',28,weight='700')
text(55,932,'Я слишком обобщил: на центральном срезе «дуг» виден зазор, а не длинная плоская стенка.',25)
text(55,968,'Утолщение найдено в других местах участка. Его нельзя приписывать этому разрезу.',25)

text(55,1035,'Как строится эталон F',31,weight='700')
text(55,1070,'Три шага. Маленькие рисунки используют те же сохранённые линии эталона.',22,'#526571')
for n,l,title,sub in [(1,85,'Снег опирается на плато','Под ним остаётся камень.'),(2,660,'Край камня задаёт высоту','От него отсчитываются 2,5 м.'),(3,1235,'Свес выступает наружу','Сверху и снизу край закруглён.')]:
    text(l,1120,str(n),34,'#2585be',weight='700');text(l+43,1117,title,24,weight='700');text(l,1154,sub,22,'#526571')
    xx,yy=plot(old,l+35,1190,scale=27,xmin=-8,xmax=3,ymin=-2,ymax=3.6,ident=f'step{n}',grid=False)
    if n==1:arrow(l+20,1248,xx(-5),yy(max(heights(old['rock'],-5))))
    if n==2:
        line(xx(0),yy(0),xx(0),yy(2.5),'#c16a20',2);text(l+340,1252,'2,5 м',21,'#a05e11')
    if n==3:
        arrow(l+345,1183,xx(1.5),yy(max(heights(old['snow'],1.5))),'#2585be')
        arrow(l+345,1329,xx(1.8),yy(min(heights(old['snow'],1.8))),'#2585be')

line(55,1382,1740,1382,'#d1dbe0',1.5)
text(55,1435,'Что разошлось на новой кромке',31,weight='700')
text(80,1476,'На реальном срезе: камень ниже, расчёт снега — по старому верху',23)
ax,ay=plot(new,100,1510,scale=27,xmin=-14,xmax=2.5,ymin=-5.4,ymax=2,ident='reason',grid=False,oldGuide=True,air=True)
text(580,1555,'Пунктир — прежний камень',21,'#626c75');arrow(599,1567,ax(-5),ay(max(heights(old['rock'],-5))),'#626c75')
text(580,1668,'Новый камень ниже',22,'#626c75');arrow(598,1650,ax(-5),ay(max(heights(new['rock'],-5))),'#626c75')
text(580,1720,'Между ними — воздух',22,'#995700')
# Conditional construction using the existing maximum lift, explicitly NOT another measured slice.
text(975,1476,'В других местах участка: схема по коду',25,weight='700')
text(975,1510,'Это не дополнительный разрез.',21,'#526571')
height=2.5+metrics['stats']['maxSupportLiftM'];sc=24;ox=1085;oy=1737
P=lambda x,y:(ox+x*sc,oy-y*sc)
points=[P(-2,height),P(0,height)]
for i in range(1,17):
    t=i/16*math.pi/2;points.append(P(2*math.sin(t),height-2+2*math.cos(t)))
points.append(P(2,.5))
for i in range(1,7):
    t=i/6*math.pi/2;points.append(P(1.5+.5*math.cos(t),.5-.5*math.sin(t)))
points.append(P(0,-.02))
pathline(points,'#2585be',width=3)
line(*P(2,.5),*P(2,height-2),'#a85d1c',5)
text(1180,1562,'Защита поднимает верх',23);arrow(1167,1569,*P(0,height),'#2585be')
text(1180,1625,'Между изгибами',23,'#a05e11');text(1180,1655,'растёт прямая стенка',23,'#a05e11');arrow(1160,1645,*P(2,(height-2+.5)/2),'#a05e11')
text(975,1785,'Предположение: эта стенка даёт основную серую полосу',20,'#6e6260')
text(975,1814,'на кадрах. Принадлежность пикселей не проверялась.',20,'#6e6260')
line(55,1860,1740,1860,'#d1dbe0',1.5)
text(55,1898,'Код и данные: разрезы, зазор и подъём • Глазами: вид края • Предположение: источник серой полосы',21)
text(55,1935,'Эталон F сохраняется. Новых кадров сцены нет; геометрия, свет и параметры не менялись.',23,weight='700')
add('</svg>')
svg='\n'.join(parts)
(HERE/'explanation.svg').write_text(svg)
(HERE/'index.html').write_text('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Почему изменился край снега F</title><style>body{margin:0;background:#fcfcfb}svg{display:block;width:100%;height:auto;max-width:1800px;margin:auto}</style>'+svg+'</html>')
print('Saved explanation from archived section geometry. No scene was loaded.')
