// Usage: CHROMIUM_PATH=/usr/bin/chromium node experiments/mountains/generated-browser.cjs [output]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const out = path.resolve(process.argv[2] ||
    path.join(root, "test-results/MOUNTAINS-002", execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
    }).trim()));
fs.mkdirSync(out, { recursive: true });
(async () => {
    const { createServer } = await import("vite");
    const server = await createServer({
        root,
        configFile: false,
        server: { host: "127.0.0.1", port: 5232, strictPort: true, hmr: false },
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
        const onlyWalk = process.env.WALK_ONLY === "1";
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico"))
                errors.push(m.text());
        });
        await page.goto("http://127.0.0.1:5232/experiments/mountains/?seed=42");
        await page.waitForFunction(() => window.__mountains?.ready, null, {
            timeout: 180000,
        });
        const ev = (fn, arg) => page.evaluate(fn, arg);
        await ev(() => window.__mountains.manual(true));
        const manifest = {
            workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], {
                cwd: root,
                encoding: "utf8",
            }).trim()),
            renderSourceSHA256: Object.fromEntries(["main.ts", "mountain-plan.ts", "generated-landforms.ts", "surface-contract.ts", "index.html", "style.css"].map((file) => [
                file,
                createHash("sha256")
                    .update(fs.readFileSync(path.join(__dirname, file)))
                    .digest("hex"),
            ])),
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
            await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
        assert.ok(displacement > 2 && displacement < 8, `keyboard movement ${displacement}`);
        manifest.movement = { before, after, displacement };
        await page.locator("#collapse").click();
        manifest.initialPlan = await ev(() => window.__mountains.land.plan);
        for (const id of (onlyWalk ? [] : await ev(() => window.__mountains.land.views.map(v => v.id)))) {
            await ev((id) => window.__mountains.view(id), id);
            await shot("42-" + id);
        }
        for (const id of (onlyWalk ? [] : ["overview", "valley-1"])) {
            for (const layer of ["clay", "terrain", "rocks", "full"]) {
                await ev(({ id, layer }) => {
                    window.__mountains.view(id);
                    window.__mountains.layers(layer);
                }, { id, layer });
                await shot(`42-${id}-${layer}`);
            }
        }
        for (const mode of (onlyWalk ? [] : ["overcast", "evening"]))
            for (const id of ["upper"]) {
                await ev(({ mode, id }) => {
                    document.getElementById("light").value = mode;
                    window.__mountains.lighting(mode);
                    window.__mountains.layers("full");
                    window.__mountains.view(id);
                }, { mode, id });
                await shot(`42-${id}-${mode}`);
            }
        await ev(() => window.__mountains.lighting("day"));
        // Walk every approach in the full scene, including return routes.
        for (const seed of (process.env.SEEDS || '42,7,2026').split(',').map(Number)) {
            await ev((seed) => window.__mountains.generate(seed), seed);
            await ev(() => window.__mountains.manual(true));
            manifest.seeds.push(await ev(() => ({ seed: window.__mountains.land.seed, plan: window.__mountains.land.plan, verification: window.__mountains.land.verification, stats: window.__mountains.stats })));
            for (const id of (onlyWalk || seed === 42 ? [] : ['overview', 'upper'])) {
                for (const layer of ['clay', 'full']) {
                    await ev(({ id, layer }) => { window.__mountains.view(id); window.__mountains.layers(layer); }, { id, layer });
                    await shot(`${seed}-${id}-${layer}`);
                }
            }
            for (const routeId of (process.env.ROUTES ? process.env.ROUTES.split(',') : await ev(() => window.__mountains.land.routes.map(r => r.id))))
                for (const direction of ["up", "down"]) {
                    const total = await ev(({ routeId, direction }) => {
                        const m = window.__mountains, r = m.land.routes.find((r) => r.id === routeId);
                        let p = m.land.worldRoute(r);
                        if (direction === "down")
                            p.reverse();
                        m.view("lower");
                        m.teleport({
                            x: p[0].x,
                            y: m.supportAt(p[0].x, p[0].z) + 1.85,
                            z: p[0].z,
                        });
                        m.steps(20);
                        return p.length;
                    }, { routeId, direction });
                    let reached = 0;
                    for (const fraction of [0.25, 0.55, 0.8, 1]) {
                        const result = await ev(({ routeId, direction, from, fraction, total }) => {
                            const m = window.__mountains;
                            let p = m.land.worldRoute(m.land.routes.find((r) => r.id === routeId));
                            if (direction === "down")
                                p.reverse();
                            const goal = Math.ceil((total - 1) * fraction);
                            let i = from, ticks = 0, maxSupportGap = 0, stuck = 0, previous = Infinity;
                            while (i <= goal && ticks < 18000) {
                                const pos = m.position, target = p[i], d = Math.hypot(pos.x - target.x, pos.z - target.z);
                                maxSupportGap = Math.max(maxSupportGap, Math.abs(pos.y - m.supportAt(pos.x, pos.z)));
                                if (d < 1.6) {
                                    i++;
                                    stuck = 0;
                                    previous = Infinity;
                                    continue;
                                }
                                stuck = d >= previous - 0.003 ? stuck + 1 : 0;
                                previous = d;
                                if (stuck > 120)
                                    break;
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
                                maxSupportGap,
                                fly: m.fly,
                                goal,
                                ticks,
                                position: m.position,
                                grounded: m.grounded,
                                contacts: m.collisions(),
                                stats: m.stats,
                            };
                        }, { routeId, direction, from: reached, fraction, total });
                        manifest.route.push({
                            seed,
                            routeId,
                            direction,
                            fraction,
                            ...result,
                        });
                        fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
                        assert.ok(result.reached > result.goal, JSON.stringify({ seed, routeId, direction, ...result }));
                        assert.ok(result.grounded && result.maxSupportGap < 2, 'route support lost');
                        assert.equal(result.fly, false, 'walking check entered fly mode');
                        console.log('WALK', seed, routeId, direction, fraction, result.reached, result.goal, result.maxSupportGap);
                        reached = result.reached;
                        if (seed === 42 && direction === "up" && (fraction === 0.55 || fraction === 1))
                            await shot(`${seed}-${routeId}-walk-${Math.round(fraction * 100)}`);
                    }
                }
        }
        // Small screen menu remains scrollable, and returning from fly lands on a real surface.
        await page.setViewportSize({ width: 390, height: 844 });
        await ev(() => {
            document.body.classList.remove("folded");
            window.__mountains.view("upper");
        });
        await shot("mobile-menu");
        assert.ok(await page
            .locator("#panel")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "mobile horizontal overflow");
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
        console.log(`PASS keyboard, ${new Set(manifest.route.map(r => r.routeId)).size} connections and returns with scene collisions; ${manifest.seeds.length} fully walked seeds; mobile menu; no browser errors. See manifest for exact coverage.`);
    }
    finally {
        await browser?.close();
        await server.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
