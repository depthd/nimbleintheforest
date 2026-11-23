import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';

// Embedded in the HTML, so a cached page reports its own build, not a newer
// version.json fetched from the server.
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const builtAt = new Date();
const time = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(builtAt);
const buildInfo = `<p class="hint build-info" title="${sha}" style="text-align:center;max-width:90vw">Версия <b>${sha.slice(0, 7)}</b><br>Сборка: <time datetime="${builtAt.toISOString()}">${time}</time> · Самара (UTC+4)</p>`;

export default defineConfig({
  base: './',
  plugins: [{
    name: 'game-pages',
    transformIndexHtml: html => html.replaceAll('<!-- build-info -->', buildInfo),
    generateBundle() {
      // Bookmarks to the former preview keep the same seed and diagnostic settings.
      this.emitFile({
        type: 'asset',
        fileName: 'test/index.html',
        source: `<!doctype html>
<html lang="ru"><meta charset="utf-8"><title>Nimble in the Forest</title>
<script>location.replace('../' + location.search + location.hash)</script>
<meta http-equiv="refresh" content="0; url=../">
<a href="../">Открыть игру</a></html>`,
      });
    },
  }],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  server: { host: true },
});
