// Emergency readout/recovery for a long running survey; not part of timed comparisons.
(async()=>{
 const list=await (await fetch('http://127.0.0.1:9229/json/list')).json();const ws=new WebSocket(list[0].webSocketDebuggerUrl),pending=new Map();let seq=0;
 await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){pending.get(d.id)(d);pending.delete(d.id);}};
 const send=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
 if(process.argv[2]==='--profile'){const x=await send('Runtime.evaluate',{expression:"(async()=>{const c=[...Object.values(process.mainModule.constructor._cache).find(m=>m.exports.chromium)?.exports.chromium._connection._objects.values()].find(o=>o._type==='CDPSession'); const r=await c.send('Profiler.stop');process.mainModule.require('node:fs').writeFileSync('/workspace/work/perf-research/results/survey-spawn.cpuprofile',JSON.stringify(r.profile));return 'saved';})()",awaitPromise:true,returnByValue:true});console.log(JSON.stringify(x));ws.close();return;}
 const objects=await send('Runtime.evaluate',{expression:"[...Object.values(process.mainModule.constructor._cache).find(m=>m.exports.chromium)?.exports.chromium._connection._objects.values()].filter(o=>o._type==='Page')"});
 
 const expression=process.argv[2]||"({ready:!!window.__game,warm:window.__survey.warm,index:window.__survey.index,enabled:window.__survey.enabled,samples:window.__survey.samples.length,tail:window.__survey.samples.slice(-2),loading:document.querySelector('#loading')?.textContent?.slice(0,200)})";
 const answer=await send('Runtime.callFunctionOn',{objectId:objects.result.result.objectId,functionDeclaration:'async function(expression){return await this[0].evaluate(expression)}',arguments:[{value:expression}],awaitPromise:true,returnByValue:true});if(process.argv[3])require('node:fs').writeFileSync(process.argv[3],JSON.stringify(answer.result.result.value,null,2));else console.log(JSON.stringify(answer,null,2));ws.close();
})().catch(e=>{console.error(e);process.exitCode=1});
