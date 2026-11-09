const {chromium}=require('playwright');
const launch=chromium.launch.bind(chromium);
chromium.launch=async opts=>{
 const b=await launch({...opts,executablePath:'/usr/bin/chromium'});
 const newPage=b.newPage.bind(b);
 b.newPage=async opts=>{
  const p=await newPage(opts),go=p.goto.bind(p),ev=p.evaluate.bind(p);
  p.goto=(url,opts)=>go(url+(url.includes('?')?'&':'?')+'warmup=0',opts);
  p.evaluate=(fn,arg)=>ev(fn,arg?.keys?{...arg,keys:arg.keys.map(k=>k==='ControlLeft'?'KeyC':k)}:arg);
  return p;
 };return b;
};
