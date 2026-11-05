// Optional frame diagnostics. Samples come from the game's existing RAF loop,
// before any simulation time clamp; no second animation loop is started.
const CAPACITY = 240;
const STORAGE_KEY = 'nimble.performance';

export class PerformanceMonitor {
  readonly element = document.createElement('section');
  enabled = false;
  onChange?: (enabled: boolean) => void;
  private samples = new Float64Array(CAPACITY);
  private count = 0;
  private cursor = 0;
  private previous: number | null = null;
  private painted = -Infinity;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private fps: HTMLElement;
  private timing: HTMLElement;

  constructor(root: HTMLElement) {
    this.element.id = 'performance-monitor';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', 'FPS и время кадра');
    this.element.innerHTML = `<div class="perf-heading"><strong data-perf="fps">FPS —</strong><span>F4 · вкл/выкл</span></div>
      <div class="perf-timing" data-perf="timing">Кадр — мс · пик — мс</div>
      <canvas width="260" height="70" role="img" aria-label="График времени последних 240 кадров в миллисекундах"></canvas>
      <div class="perf-caption">Время кадра, мс · последние 240 кадров</div>`;
    root.appendChild(this.element);
    this.canvas = this.element.querySelector('canvas')!;
    this.context = this.canvas.getContext('2d')!;
    this.fps = this.element.querySelector('[data-perf="fps"]')!;
    this.timing = this.element.querySelector('[data-perf="timing"]')!;
    let initial = false;
    try { initial = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage can be unavailable */ }
    const override = new URLSearchParams(location.search).get('fps');
    if (override === '1' || override === '0') initial = override === '1';
    this.setEnabled(initial, false);
    window.addEventListener('keydown', e => {
      if (e.code !== 'F4' || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (!e.repeat) this.setEnabled(!this.enabled);
    });
    document.addEventListener('visibilitychange', () => { this.previous = null; });
  }

  setEnabled(enabled: boolean, persist = true) {
    this.enabled = enabled;
    this.element.hidden = !enabled;
    this.previous = null;
    this.count = this.cursor = 0;
    this.painted = -Infinity;
    if (persist) try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch { /* optional preference */ }
    if (enabled) this.draw();
    this.onChange?.(enabled);
  }

  frame(now: number) {
    if (!this.enabled || document.hidden) return;
    const previous = this.previous;
    this.previous = now;
    if (previous === null) return; // do not count generation, tab switches or enabling the panel
    const ms = now - previous;
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.samples[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % CAPACITY;
    this.count = Math.min(CAPACITY, this.count + 1);
    // Collect every frame; repaint this small overlay at most four times a second.
    if (now - this.painted >= 250) { this.painted = now; this.draw(); }
  }

  private sample(index: number) { return this.samples[(this.cursor - this.count + index + CAPACITY) % CAPACITY]; }

  private draw() {
    const fmt = (n: number) => n.toFixed(1).replace('.', ',');
    let peak = 0, elapsed = 0, frames = 0;
    for (let i = 0; i < this.count; i++) peak = Math.max(peak, this.sample(i));
    // FPS is frames / elapsed time over roughly the last second, rather than
    // an average of reciprocals that would hide slow frames.
    for (let i = this.count - 1; i >= 0 && elapsed < 1000; i--) { elapsed += this.sample(i); frames++; }
    this.fps.textContent = elapsed ? `FPS ${fmt(frames * 1000 / elapsed)}` : 'FPS —';
    this.timing.textContent = this.count ? `Кадр ${fmt(this.sample(this.count - 1))} мс · пик ${fmt(peak)} мс` : 'Кадр — мс · пик — мс';
    const c = this.context, { width, height } = this.canvas;
    const top = 9, bottom = height - 8, right = width - 31;
    const scale = Math.max(50, Math.ceil(peak / 10) * 10);
    const y = (ms: number) => bottom - ms / scale * (bottom - top);
    c.clearRect(0, 0, width, height);
    c.font = '10px system-ui'; c.fillStyle = '#9aa8b6';
    c.fillText(String(Math.round(scale)), right + 5, top + 3);
    c.fillText('0', right + 5, bottom + 3);
    c.setLineDash([3, 3]);
    for (const [ms, colour] of [[1000 / 60, '#8fd18b'], [1000 / 30, '#f0c36a']] as const) {
      c.strokeStyle = colour; c.globalAlpha = 0.5;
      c.beginPath(); c.moveTo(0, y(ms)); c.lineTo(right, y(ms)); c.stroke();
      if (scale <= 100) { c.fillStyle = colour; c.fillText(fmt(ms), right + 5, y(ms) + 3); }
    }
    c.setLineDash([]); c.globalAlpha = 1;
    for (let i = 0; i < this.count; i++) {
      const ms = this.sample(i), x = (CAPACITY - this.count + i) / CAPACITY * right;
      c.fillStyle = ms <= 1000 / 60 + 0.1 ? '#8fd18b' : ms <= 1000 / 30 + 0.1 ? '#f0c36a' : '#ff7a6a';
      c.fillRect(x, y(ms), Math.max(0.8, right / CAPACITY - 0.1), Math.max(1, bottom - y(ms)));
    }
  }
}
