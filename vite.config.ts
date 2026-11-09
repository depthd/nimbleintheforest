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
const label = process.env.BUILD_CHANNEL === 'test' ? 'Тестовая версия' : 'Версия';
const buildInfo = `<p class="hint build-info" title="${sha}" style="text-align:center;max-width:90vw">${label} <b>${sha.slice(0, 7)}</b><br>Сборка: <time datetime="${builtAt.toISOString()}">${time}</time> · Самара (UTC+4)</p>`;

export default defineConfig({
  base: './',
  plugins: [{ name: 'build-info', transformIndexHtml: html => html.replaceAll('<!-- build-info -->', buildInfo) }],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  server: { host: true },
});
