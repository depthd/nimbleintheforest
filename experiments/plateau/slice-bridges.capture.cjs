// Proof frames and a local rendering-cost comparison in the integrated scene.
// Start Vite first. Set PLATEAU_URL if the server runs on a different origin.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const dir = path.resolve(__dirname,'../../docs/mountains-slice/bridges');
const origin = process.env.PLATEAU_URL || 'http://127.0.0.1:5184';
const views = [
  {name:'profile', eye:[72,14.5,30], target:[75,12.9,0]},
  {name:'bank', eye:[53.5,16.7,-1.8], target:[76,13.4,.4]},
  {name:'on-deck', eye:[74,14.12,.4], target:[91,15.1,.4]},
];

async function main() {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:1});
    await page.routeWebSocket('**/*',socket=>socket.close());
    await page.addInitScript(()=>{
      const counts = window.__bridgeDraws = {draws:0,triangles:0};
      const proto = WebGL2RenderingContext.prototype;
      for (const name of ['drawArrays','drawArraysInstanced','drawElements','drawElementsInstanced']) {
        const draw = proto[name];
        proto[name] = function(...args) {
          counts.draws++;
          if (args[0]===this.TRIANGLES) {
            const count = name.includes('Elements') ? args[1] : args[2];
            const instances = name.endsWith('Instanced') ? args[args.length-1] : 1;
            counts.triangles+=count/3*instances;
          }
          return draw.apply(this,args);
        };
      }
    });
    const captures=[];
    for (const seed of [42,7,8191,23011]) {
      await page.goto(origin+'/experiments/plateau/route.html?seed='+seed+'&wall=original&qa=1');
      await page.waitForFunction(()=>window.__route?.ready,null,{timeout:60000});
      await page.addStyleTag({content:'header,footer{display:none!important}'});
      const raw=await page.evaluate(async ({seed,views})=>{
        const {G} = await import('/src/game/ctx.ts');
        const bridge = G.scene.getObjectByName('suspension-bridge');
        const gl = document.querySelector('canvas').getContext('webgl2');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const {survey} = window.__route;
        const pixel = new Uint8Array(4);
        const sync = ()=>gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        const measure = (visible)=>{
          bridge.visible=visible;
          const {eye,target}=views[0];
          for (let i=0;i<4;i++) { survey(eye,target); sync(); }
          const samples=[];
          let calls,triangles;
          for (let i=0;i<12;i++) {
            window.__bridgeDraws.draws=window.__bridgeDraws.triangles=0;
            const start=performance.now();
            survey(eye,target);
            sync();
            samples.push(performance.now()-start);
            ({draws:calls,triangles}=window.__bridgeDraws);
          }
          samples.sort((a,b)=>a-b);
          return {calls,triangles,medianMs:(samples[5]+samples[6])/2,rangeMs:[samples[0],samples.at(-1)]};
        };
        const off=measure(false),on=measure(true);
        return {seed,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
          off,on,endpoints:[window.__route.bridge[0],window.__route.bridge.at(-1)]};
      },{seed,views});
      for (const view of (seed===42?views:views.slice(0,1))) {
        const url = await page.evaluate(view=>{
          window.__route.survey(view.eye,view.target);
          return document.querySelector('canvas').toDataURL('image/jpeg',.92);
        },view);
        fs.writeFileSync(path.join(dir,'bridge-'+seed+'-'+view.name+'.jpg'),Buffer.from(url.split(',')[1],'base64'));
      }
      console.log(seed,raw.off,raw.on);
      captures.push(raw);
    }
    fs.writeFileSync(path.join(dir,'browser.json'),JSON.stringify({
      viewport:[960,540],browser:browser.version(),views,measure:'12 renders per state, synchronized WebGL readPixels, median; camera profile, bridge group hidden/visible',
      captures},null,2)+'\n');
  } finally { await browser.close(); }
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
