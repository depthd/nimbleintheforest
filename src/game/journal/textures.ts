// @ts-nocheck
// Canvas artwork supplied in Dnevnik_pervy_variant(1).zip.
import * as THREE from 'three';

const W = 768;
const H = 1080;
const INK = 'rgba(45, 39, 29, .88)';
const FADED = 'rgba(55, 45, 31, .56)';

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function canvas() {
  const el = document.createElement('canvas');
  el.width = W;
  el.height = H;
  return el;
}

function roughLine(ctx, x1, y1, x2, y2, width = 2, color = FADED) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const mx = (x1 + x2) / 2;
  ctx.quadraticCurveTo(mx, (y1 + y2) / 2 + 1.5, x2, y2);
  ctx.stroke();
  ctx.globalAlpha = .22;
  ctx.beginPath();ctx.moveTo(x1 + 2, y1 + 2);ctx.lineTo(x2 - 1, y2 + 1);ctx.stroke();
  ctx.restore();
}

function roughCircle(ctx, x, y, r, width = 5, color = INK) {
  ctx.save();ctx.strokeStyle = color;ctx.lineWidth = width;ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = i === 0 ? .8 : .22;
    ctx.beginPath();
    ctx.ellipse(x + i - 1, y + (i % 2), r + i * .8, r - i * .5, .018 * i, .06, Math.PI * 2 - .04);
    ctx.stroke();
  }
  ctx.restore();
}

function makePaper(seed) {
  const out = canvas();
  const ctx = out.getContext('2d');
  const rnd = mulberry32(seed);
  const low = document.createElement('canvas');
  low.width = 192;low.height = 270;
  const lctx = low.getContext('2d');
  const data = lctx.createImageData(low.width, low.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const grain = (rnd() - .5) * 34;
    const fiber = rnd() > .93 ? -20 : 0;
    data.data[i] = 177 + grain + fiber;
    data.data[i + 1] = 149 + grain * .82 + fiber;
    data.data[i + 2] = 103 + grain * .55 + fiber * .7;
    data.data[i + 3] = 255;
  }
  lctx.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(low, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;

  for (let i = 0; i < 32; i++) {
    const x = rnd() * W, y = rnd() * H, radius = 20 + rnd() * 115;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(55,39,22,${.015 + rnd() * .045})`);
    g.addColorStop(1, 'rgba(55,39,22,0)');
    ctx.fillStyle = g;ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const edge = ctx.createRadialGradient(W / 2, H / 2, H * .2, W / 2, H / 2, H * .68);
  edge.addColorStop(.5, 'rgba(49,31,16,0)');edge.addColorStop(1, 'rgba(42,28,15,.43)');
  ctx.fillStyle = edge;ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(46,34,22,.24)';ctx.lineWidth = 7;ctx.strokeRect(7, 5, W - 14, H - 10);
  ctx.strokeStyle = 'rgba(221,194,143,.23)';ctx.lineWidth = 2;ctx.strokeRect(14, 12, W - 28, H - 24);
  for (let i = 0; i < 1050; i++) {
    const x = rnd() * W, y = rnd() * H;
    ctx.fillStyle = rnd() > .45 ? 'rgba(42,32,21,.13)' : 'rgba(231,206,157,.16)';
    ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  for (let i = 0; i < 34; i++) {
    const y = rnd() * H;
    roughLine(ctx, rnd() * 45, y, W - rnd() * 45, y + (rnd() - .5) * 8, .7, 'rgba(63,45,25,.09)');
  }
  return out;
}

function text(ctx, value, x, y, size = 42, align = 'left', color = INK) {
  ctx.save();ctx.font = `${size}px Neucha, cursive`;ctx.textAlign = align;ctx.textBaseline = 'alphabetic';ctx.fillStyle = color;
  ctx.fillText(value, x, y);ctx.restore();
}

function drawMeat(ctx, x, y, s = 1) {
  ctx.save();ctx.translate(x, y);ctx.rotate(-.48);ctx.scale(s, s);ctx.strokeStyle = INK;ctx.fillStyle = 'rgba(50,40,27,.16)';ctx.lineWidth = 6;ctx.lineJoin = 'round';
  ctx.beginPath();ctx.moveTo(-38,-20);ctx.bezierCurveTo(-15,-48,28,-38,39,-9);ctx.bezierCurveTo(48,18,13,39,-19,33);ctx.bezierCurveTo(-46,27,-55,1,-38,-20);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.lineWidth = 4;ctx.beginPath();ctx.ellipse(-17,-9,9,13,.5,0,Math.PI*2);ctx.ellipse(14,13,8,10,-.4,0,Math.PI*2);ctx.stroke();
  ctx.restore();
}

function drawDrop(ctx, x, y, s = 1) {
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle=INK;ctx.fillStyle='rgba(45,38,27,.18)';ctx.lineWidth=5;
  ctx.beginPath();ctx.moveTo(0,-48);ctx.bezierCurveTo(-10,-25,-34,-2,-33,18);ctx.bezierCurveTo(-32,47,29,49,33,18);ctx.bezierCurveTo(34,-3,11,-28,0,-48);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.globalAlpha=.4;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-17,17);ctx.bezierCurveTo(-15,32,2,36,13,25);ctx.stroke();ctx.restore();
}

function drawBed(ctx, x, y, s = 1) {
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle=INK;ctx.lineWidth=7;ctx.lineCap='square';ctx.lineJoin='miter';
  ctx.beginPath();ctx.moveTo(-42,35);ctx.lineTo(-42,-34);ctx.lineTo(-24,-34);ctx.lineTo(-24,-6);ctx.lineTo(37,-6);ctx.lineTo(37,35);ctx.moveTo(-42,13);ctx.lineTo(42,13);ctx.lineTo(42,35);ctx.moveTo(-24,-5);ctx.lineTo(-24,-27);ctx.lineTo(0,-27);ctx.lineTo(0,-5);ctx.stroke();ctx.restore();
}

function drawSnowflake(ctx,x,y,s=1){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle=INK;ctx.lineWidth=4;ctx.lineCap='round';
  for(let i=0;i<6;i++){ctx.rotate(Math.PI/3);ctx.beginPath();ctx.moveTo(0,-34);ctx.lineTo(0,34);ctx.moveTo(0,-22);ctx.lineTo(-8,-14);ctx.moveTo(0,-22);ctx.lineTo(8,-14);ctx.stroke();}ctx.restore();
}

function drawCross(ctx,x,y,s=1){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle=INK;ctx.beginPath();ctx.moveTo(-9,-30);ctx.lineTo(9,-30);ctx.lineTo(9,-9);ctx.lineTo(30,-9);ctx.lineTo(30,9);ctx.lineTo(9,9);ctx.lineTo(9,30);ctx.lineTo(-9,30);ctx.lineTo(-9,9);ctx.lineTo(-30,9);ctx.lineTo(-30,-9);ctx.lineTo(-9,-9);ctx.closePath();ctx.fill();ctx.restore();
}

function drawBolt(ctx,x,y,s=1){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle=INK;ctx.lineWidth=5;ctx.lineJoin='miter';ctx.beginPath();ctx.moveTo(8,-40);ctx.lineTo(-22,5);ctx.lineTo(-3,5);ctx.lineTo(-12,39);ctx.lineTo(24,-10);ctx.lineTo(4,-10);ctx.closePath();ctx.stroke();ctx.restore();
}

function drawBody(ctx) {
  ctx.save();ctx.translate(320,370);ctx.strokeStyle='rgba(38,33,25,.76)';ctx.fillStyle='rgba(39,34,25,.43)';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
  const shapes=[
    [[-20,-156],[-30,-137],[-65,-119],[-78,-87],[-62,-24],[-49,42],[-34,77],[34,77],[49,42],[62,-24],[78,-87],[65,-119],[30,-137],[20,-156]],
    [[-65,-113],[-86,-81],[-92,-18],[-108,62],[-116,121],[-101,137],[-84,76],[-69,9],[-53,-54]],
    [[65,-113],[86,-81],[92,-18],[108,62],[116,121],[101,137],[84,76],[69,9],[53,-54]],
    [[-35,68],[-4,73],[-10,146],[-25,219],[-35,286],[-57,286],[-53,218],[-49,145]],
    [[35,68],[4,73],[10,146],[25,219],[35,286],[57,286],[53,218],[49,145]]
  ];
  ctx.beginPath();ctx.ellipse(0,-194,33,42,-.06,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(-18,-226);ctx.lineTo(-17,-155);ctx.lineTo(18,-155);ctx.lineTo(17,-226);ctx.closePath();ctx.fill();
  for(const points of shapes){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.save();ctx.beginPath();ctx.moveTo(-65,-119);ctx.lineTo(65,-119);ctx.lineTo(49,44);ctx.lineTo(34,77);ctx.lineTo(-34,77);ctx.lineTo(-49,44);ctx.closePath();ctx.clip();
  ctx.lineWidth=2;ctx.globalAlpha=.55;
  for(let i=-125;i<100;i+=9){ctx.beginPath();ctx.moveTo(i,-150);ctx.lineTo(i+120,105);ctx.stroke();}
  for(let i=-80;i<140;i+=10){ctx.beginPath();ctx.moveTo(i,-130);ctx.lineTo(i-115,100);ctx.stroke();}
  ctx.restore();
  ctx.globalAlpha=.46;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-22,-135);ctx.lineTo(0,-109);ctx.lineTo(22,-135);ctx.moveTo(0,-109);ctx.lineTo(0,54);ctx.moveTo(-42,-34);ctx.lineTo(42,-34);ctx.moveTo(-38,45);ctx.lineTo(38,45);ctx.stroke();
  ctx.globalAlpha=.34;for(let i=0;i<12;i++){ctx.beginPath();ctx.moveTo(-46+i*3,96+i*12);ctx.lineTo(-48+i*2,124+i*12);ctx.moveTo(46-i*3,96+i*12);ctx.lineTo(48-i*2,124+i*12);ctx.stroke();}
  ctx.restore();
}

function makeLeftBase() {
  const out = makePaper(9137);const ctx=out.getContext('2d');
  text(ctx,'Мои потребности',62,91,50);
  roughLine(ctx,58,112,704,108,2.2);
  const centers=[150,384,618];
  for(const x of centers) roughCircle(ctx,x,318,83,7,'rgba(49,41,29,.66)');
  drawMeat(ctx,150,318,1.05);drawDrop(ctx,384,318,1.05);drawBed(ctx,618,318,.95);
  text(ctx,'Голод',150,452,43,'center');text(ctx,'Жажда',384,452,43,'center');text(ctx,'Усталость',618,452,43,'center');
  roughLine(ctx,57,510,710,506,2.2);
  text(ctx,'Ощущение температуры',64,596,44);
  roughLine(ctx,74,686,694,686,7,'rgba(52,43,29,.54)');
  roughLine(ctx,74,672,74,700,2);roughLine(ctx,384,672,384,700,2);roughLine(ctx,694,672,694,700,2);
  text(ctx,'Холодно',70,756,33);text(ctx,'Нормально',384,756,33,'center');text(ctx,'Тепло',694,756,33,'right');
  roughLine(ctx,67,807,699,807,1.4,'rgba(55,45,31,.28)');
  return out;
}

function makeRightBase() {
  const out=makePaper(41721);const ctx=out.getContext('2d');
  drawBody(ctx);
  const ys=[132,290,448,606];
  for(const y of ys) roughCircle(ctx,646,y,53,4,'rgba(48,40,29,.7)');
  drawSnowflake(ctx,646,132,.88);drawDrop(ctx,646,290,.75);drawCross(ctx,646,448,.85);drawBolt(ctx,646,606,.85);
  roughLine(ctx,58,690,710,686,1.6,'rgba(55,45,31,.28)');
  const conditions=['Обморожение','Порез','Ушиб','Кровотечение'];
  conditions.forEach((label,i)=>{
    const y=758+i*69;roughCircle(ctx,79,y-10,10,2.5,'rgba(48,40,29,.65)');text(ctx,label,111,y,36);
    for(let j=0;j<5;j++) roughLine(ctx,431+j*48,y-18,461+j*48,y-18,5,'rgba(55,45,31,.15)');
  });
  return out;
}

function drawArc(ctx,x,y,r,value){
  const start=-Math.PI/2;const end=start+Math.PI*2*Math.max(.001,value/100);
  ctx.save();ctx.strokeStyle='rgba(36,32,24,.94)';ctx.lineWidth=12;ctx.lineCap='butt';ctx.beginPath();ctx.arc(x,y,r,start,end,false);ctx.stroke();
  ctx.strokeStyle='rgba(115,91,54,.42)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,r-8,start,end,false);ctx.stroke();
  const ex=x+Math.cos(end)*r,ey=y+Math.sin(end)*r;ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ex+Math.cos(end)*-10,ey+Math.sin(end)*-10);ctx.lineTo(ex+Math.cos(end)*10,ey+Math.sin(end)*10);ctx.stroke();ctx.restore();
}

function drawTemperature(ctx,value){
  const normalized=Math.max(0,Math.min(1,(value+40)/60));const x=74+620*normalized;
  ctx.save();ctx.strokeStyle='rgba(37,32,24,.94)';ctx.fillStyle='rgba(37,32,24,.85)';ctx.lineWidth=5;
  ctx.beginPath();ctx.moveTo(x,660);ctx.lineTo(x,711);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x-8,657);ctx.lineTo(x+8,657);ctx.lineTo(x,646);ctx.closePath();ctx.fill();
  ctx.restore();
  const formatted=value>0?`+${Math.round(value)}`:`${Math.round(value)}`.replace('-','−');
  text(ctx,`${formatted} °C`,384,927,92,'center','rgba(38,32,23,.9)');
}

export function createDiaryTextures(renderer) {
  let leftBase=makeLeftBase();let rightBase=makeRightBase();
  const left=canvas();const right=canvas();
  right.getContext('2d').drawImage(rightBase,0,0);
  const leftTexture=new THREE.CanvasTexture(left);const rightTexture=new THREE.CanvasTexture(right);
  for(const texture of [leftTexture,rightTexture]){
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  }
  rightTexture.needsUpdate=true;
  function update(state){
    const ctx=left.getContext('2d');ctx.clearRect(0,0,W,H);ctx.drawImage(leftBase,0,0);
    drawArc(ctx,150,318,83,state.hunger);drawArc(ctx,384,318,83,state.thirst);drawArc(ctx,618,318,83,state.fatigue);
    drawTemperature(ctx,state.temperature);leftTexture.needsUpdate=true;
    const r=right.getContext('2d');r.clearRect(0,0,W,H);r.drawImage(rightBase,0,0);
    [state.frost, state.wetness, state.condition/100, state.stamina].forEach((v,i)=>drawArc(r,646,[132,290,448,606][i],53,Math.max(0,Math.min(100,(v||0)*100))));
    text(r,'Мороз · сырость · здоровье · силы',384,54,29,'center');
    for(let j=0;j<5;j++) if(state.frost>j/5) roughLine(r,431+j*48,740,461+j*48,740,5,INK);
    // Cuts, bruises and bleeding have no independent simulation in Body.
    [827,896,965].forEach(y=>text(r,'нет данных',560,y,26,'center'));
    rightTexture.needsUpdate=true;
  }
  return {leftTexture,rightTexture,update,refreshFonts(){leftBase=makeLeftBase();rightBase=makeRightBase();}};
}
