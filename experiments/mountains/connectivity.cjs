// Structural checks complement Rapier walking; they do not rate visual quality.
const assert = require('node:assert/strict');
function checkConnectivity(land) {
  const ids = new Set(land.regions.map(r => r.id));
  const edges = land.plan.traversal;
  const visited = new Set(['lowland']);
  for (let n=0; n<ids.size; n++) for (const e of edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `Unknown endpoint ${e.id}`);
    if (visited.has(e.from)) visited.add(e.to);
    if (visited.has(e.to)) visited.add(e.from);
  }
  assert.equal(visited.size, ids.size, 'Every geographic region must be connected');
  assert.ok(edges.length - ids.size + 1 >= 2, 'The district needs independent return loops');
  // Keep useful open ground around destination centres, not merely a walkable line.
  for (const id of ['lake', 'shoulder', 'cirque']) {
    const r = land.regions.find(r => r.id === id);
    let open = 0;
    for (let z=-48; z<=48; z+=8) for (let x=-48; x<=48; x+=8) {
      const p=land.world(r.x+x,r.z+z);
      if (land.slopeAt(p.x,p.z)<.5 && Math.abs(land.heightAt(p.x,p.z)-r.y)<18) open++;
    }
    assert.ok(open>=60, `${id}: destination has insufficient open floor (${open})`);
  }
  // All ports of a region must be mutually reachable on its local surface.
  // Raster test includes ice, and limits both cell slope and step gradient.
  for (const r of land.regions) {
    const ports=land.routes.flatMap(route => [
      ...(route.from===r.id ? [route.points[0]] : []),
      ...(route.to===r.id ? [route.points.at(-1)] : [])
    ]);
    if (ports.length<2) continue;
    const step=4, pad=100;
    const minX=Math.floor((Math.min(...ports.map(p=>p.x))-pad)/step)*step;
    const minZ=Math.floor((Math.min(...ports.map(p=>p.z))-pad)/step)*step;
    const nx=Math.ceil((Math.max(...ports.map(p=>p.x))+pad-minX)/step)+1;
    const nz=Math.ceil((Math.max(...ports.map(p=>p.z))+pad-minZ)/step)+1;
    const heights=new Float32Array(nx*nz), valid=new Uint8Array(nx*nz);
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++) {
      const p=land.world(minX+i*step,minZ+j*step),k=j*nx+i,water=land.waterAt(p.x,p.z);
      heights[k]=Math.max(land.heightAt(p.x,p.z),Number.isFinite(water)?water:-Infinity);
      valid[k]=land.slopeAt(p.x,p.z)<.85 || Number.isFinite(water) ? 1:0;
    }
    const cell=p=>Math.round((p.z-minZ)/step)*nx+Math.round((p.x-minX)/step);
    const queue=[cell(ports[0])],seen=new Set(queue);
    for(let q=0;q<queue.length;q++) {
      const k=queue[q],x=k%nx,z=Math.floor(k/nx);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const xx=x+dx,zz=z+dz,t=zz*nx+xx;
        if(xx<0||zz<0||xx>=nx||zz>=nz||!valid[t]||seen.has(t)||Math.abs(heights[t]-heights[k])/step>.7)continue;
        seen.add(t);queue.push(t);
      }
    }
    for(const port of ports)assert.ok(seen.has(cell(port)),`${r.id}: disconnected arrival/departure port`);
  }
  return {regions:ids.size,connections:edges.length,independentLoops:edges.length-ids.size+1};
}
module.exports={checkConnectivity};
