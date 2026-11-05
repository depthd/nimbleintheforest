// Shared by the complete browser suite and its isolated performance-only mode.
module.exports = page => page.evaluate(async () => {
  const g = window.__game, { G } = g, s = G.snow;
  g.setManualStepping(true); G.input.enabled = true; G.input.keys.clear();
  G.player.avatar.inspectionView = 1;
  const cases = [];
  for (const enabled of [false, true, true, false]) {
    s.setEnabled(enabled); g.steps(90); G.input.keys.add('KeyW');
    const simulation = [];
    for (let i = 0; i < 300; i++) {
      const start = performance.now(); g.steps(1); if (enabled) s.renderer.update(G.player.pos);
      simulation.push(performance.now() - start);
    }
    G.input.keys.clear(); s.setEnabled(enabled); g.steps(90); G.player.updateCamera(0); G.input.keys.add('KeyW');
    const frames = [], cpu = [], renderUpdate = [], boots = []; let last = 0;
    for (let i = 0; i < 20; i++) {
      const now = await new Promise(r => requestAnimationFrame(r));
      const start = performance.now(); g.steps(1); const afterStep = performance.now();
      if (enabled) s.renderer.update(G.player.pos);
      if (i >= 5) { frames.push(now - last); cpu.push(afterStep - start); renderUpdate.push(performance.now() - afterStep); boots.push(enabled ? s.bootMs : 0); }
      last = now;
    }
    G.input.keys.clear();
    cases.push({ enabled, simulation, frames, cpu, renderUpdate, boots,
      calls: G.renderer.info.render.calls, triangles: G.renderer.info.render.triangles, stats: s.stats() });
  }
  s.setEnabled(true); return cases;
});
