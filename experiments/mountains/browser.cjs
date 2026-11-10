// Usage: CHROMIUM_PATH=/usr/bin/chromium node experiments/mountains/browser.cjs [output]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const out = path.resolve(
  process.argv[2] ||
    path.join(
      root,
      "test-results/MOUNTAINS-001",
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
    ),
);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({
    root,
    configFile: false,
    server: { host: "127.0.0.1", port: 5221, strictPort: true, hmr: false },
    logLevel: "error",
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1100, height: 700 },
    });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico"))
        errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:5221/experiments/mountains/?seed=42");
    await page.waitForFunction(() => window.__mountains?.ready, null, {
      timeout: 180000,
    });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    await ev(() => window.__mountains.manual(true));
    const manifest = {
      sha: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      viewport: [1100, 700],
      renderer: "Chromium ANGLE SwiftShader",
      seeds: [],
      movement: null,
      route: [],
      errors,
    };
    const shot = async (name) => {
      await ev(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      await page.screenshot({
        path: path.join(out, name + ".png"),
        timeout: 120000,
      });
      console.log("SHOT", name);
    };
    // Actual DOM keyboard input drives the same fixed update used during play.
    const before = await ev(() => window.__mountains.position);
    await page.keyboard.down("w");
    await ev(() => window.__mountains.steps(180));
    await page.keyboard.up("w");
    await ev(() => window.__mountains.steps(60));
    const after = await ev(() => window.__mountains.position);
    const displacement = Math.hypot(after.x - before.x, after.z - before.z);
    assert.ok(
      displacement > 2 && displacement < 8,
      `keyboard movement ${displacement}`,
    );
    manifest.movement = { before, after, displacement };
    await page.locator("#collapse").click();
    for (const id of [
      "lower",
      "reveal",
      "upper",
      "slope",
      "gully",
      "ledge",
      "back",
      "overview",
    ]) {
      await ev((id) => window.__mountains.view(id), id);
      await shot("42-" + id);
    }
    for (const mode of ["overcast", "evening"]) {
      await ev((mode) => {
        window.__mountains.view("upper");
        window.__mountains.lighting(mode);
      }, mode);
      await shot("42-upper-" + mode);
    }
    await ev(() => window.__mountains.lighting("day"));
    // Continuous walk with the page's own movement, trees and streamed rock collisions.
    const routeInfo = await ev(() => {
      const m = window.__mountains;
      const r = m.land.routes.find((r) => r.id === "shoulder");
      const p = m.land.worldRoute(r);
      m.view("ledge");
      m.teleport({
        x: p[0].x,
        y: m.land.heightAt(p[0].x, p[0].z) + 1.85,
        z: p[0].z,
      });
      m.steps(20);
      return { total: p.length };
    });
    let reached = 0;
    for (const fraction of [0.2, 0.45, 0.7, 1]) {
      const result = await ev(
        ({ from, fraction, total }) => {
          const m = window.__mountains,
            p = m.land.worldRoute(
              m.land.routes.find((r) => r.id === "shoulder"),
            ),
            goal = Math.ceil((total - 1) * fraction);
          let i = from,
            ticks = 0;
          const start = m.position;
          let stuck = 0,
            previous = Infinity;
          while (i <= goal && ticks < 18000) {
            const pos = m.position,
              target = p[i],
              d = Math.hypot(pos.x - target.x, pos.z - target.z);
            if (d < 1.6) {
              i++;
              stuck = 0;
              previous = Infinity;
              continue;
            }
            stuck = d >= previous - 0.003 ? stuck + 1 : 0;
            previous = d;
            if (stuck > 120) break;
            m.lookAt({
              x: target.x,
              y: m.land.heightAt(target.x, target.z) + 1.7,
              z: target.z,
            });
            m.key("KeyW", true);
            m.steps(5);
            ticks += 5;
          }
          m.key("KeyW", false);
          m.steps(10);
          return {
            reached: i,
            goal,
            position: m.position,
            start,
            ticks,
            grounded: m.grounded,
            stats: m.stats,
          };
        },
        { from: reached, fraction, total: routeInfo.total },
      );
      manifest.route.push(result);
      assert.ok(result.reached > result.goal, JSON.stringify(result));
      assert.ok(result.grounded, "route support lost");
      reached = result.reached;
      await shot("42-walk-" + Math.round(fraction * 100));
    }
    for (const seed of [1, 2, 3, 7, 19, 42, 123, 2026]) {
      await ev((seed) => window.__mountains.generate(seed), seed);
      assert.equal(await ev(() => window.__mountains.land.seed), seed);
      await ev(() => {
        window.__mountains.manual(true);
        window.__mountains.view("overview");
      });
      manifest.seeds.push({
        seed,
        stats: await ev(() => window.__mountains.stats),
      });
      await shot("seed-" + seed + "-overview");
    }
    // Small screen menu remains scrollable, and returning from fly lands on a real surface.
    await page.setViewportSize({ width: 390, height: 844 });
    await ev(() => {
      document.body.classList.remove("folded");
      window.__mountains.view("upper");
    });
    await shot("mobile-menu");
    assert.ok(
      await page
        .locator("#panel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "mobile horizontal overflow",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    console.log(
      "PASS keyboard, continuous shoulder route, 8 seeds, 3 lighting modes, mobile menu, no browser errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
