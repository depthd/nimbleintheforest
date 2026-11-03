// Procedural canvas textures, so the game needs no external assets.
import * as THREE from 'three';
import { mulberry32 } from './rng';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;

const cache = new Map<string, THREE.Texture>();

function make(key: string, w: number, h: number, draw: Draw, repeat = true): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h, mulberry32(key.length * 7919 + key.charCodeAt(0)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, base: [number, number, number], amp: number, count: number, size = 1) {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (r() - 0.5) * amp;
    ctx.fillStyle = `rgba(${clamp255(base[0] + v)},${clamp255(base[1] + v)},${clamp255(base[2] + v)},0.6)`;
    ctx.fillRect(r() * w, r() * h, size + r() * size, size + r() * size);
  }
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export const Tex = {
  snow: () =>
    make('snow', 256, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [236, 240, 246], 22, 4000, 2);
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
        ctx.fillRect(r() * w, r() * h, 1, 1);
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(190,205,225,0.12)`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 10 + r() * 30, 4 + r() * 10, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }),

  planks: () =>
    make('planks', 256, 256, (ctx, w, h, r) => {
      const rows = 6;
      for (let i = 0; i < rows; i++) {
        const base = 110 + r() * 30;
        ctx.fillStyle = `rgb(${base},${base * 0.68},${base * 0.42})`;
        ctx.fillRect(0, (i * h) / rows, w, h / rows);
        for (let k = 0; k < 40; k++) {
          ctx.strokeStyle = `rgba(60,35,18,${0.08 + r() * 0.15})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const y = (i * h) / rows + r() * (h / rows);
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 6, w * 0.6, y + (r() - 0.5) * 6, w, y + (r() - 0.5) * 4);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(30,18,8,0.7)';
        ctx.fillRect(0, (i * h) / rows, w, 2);
        if (r() < 0.6) {
          ctx.fillStyle = 'rgba(50,30,15,0.5)';
          ctx.beginPath();
          ctx.ellipse(r() * w, (i + 0.5) * (h / rows), 5, 3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }),

  logWall: () =>
    make('logwall', 256, 256, (ctx, w, h, r) => {
      const rows = 4;
      for (let i = 0; i < rows; i++) {
        const y0 = (i * h) / rows;
        const rh = h / rows;
        const g = ctx.createLinearGradient(0, y0, 0, y0 + rh);
        const b = 95 + r() * 20;
        g.addColorStop(0, `rgb(${b * 0.5},${b * 0.33},${b * 0.2})`);
        g.addColorStop(0.25, `rgb(${b * 1.15},${b * 0.8},${b * 0.5})`);
        g.addColorStop(0.6, `rgb(${b},${b * 0.68},${b * 0.42})`);
        g.addColorStop(1, `rgb(${b * 0.45},${b * 0.3},${b * 0.18})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, y0, w, rh);
        for (let k = 0; k < 30; k++) {
          ctx.strokeStyle = `rgba(50,30,15,${0.1 + r() * 0.12})`;
          ctx.beginPath();
          const y = y0 + 6 + r() * (rh - 12);
          ctx.moveTo(0, y);
          ctx.lineTo(w, y + (r() - 0.5) * 3);
          ctx.stroke();
        }
      }
    }),

  barkSpruce: () =>
    make('bark_spruce', 128, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [72, 52, 38], 30, 1500, 2);
      for (let i = 0; i < 70; i++) {
        ctx.strokeStyle = `rgba(30,20,12,${0.3 + r() * 0.4})`;
        ctx.lineWidth = 1 + r() * 2;
        const x = r() * w;
        ctx.beginPath();
        ctx.moveTo(x, r() * h);
        ctx.lineTo(x + (r() - 0.5) * 6, r() * h);
        ctx.stroke();
      }
    }),

  barkBirch: () =>
    make('bark_birch', 128, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [228, 226, 218], 18, 1500, 2);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(30,30,30,${0.5 + r() * 0.5})`;
        ctx.fillRect(r() * w, r() * h, 6 + r() * 28, 1 + r() * 3);
      }
    }),

  barkDead: () =>
    make('bark_dead', 128, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [120, 112, 104], 26, 1500, 2);
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(60,55,50,${0.4 + r() * 0.4})`;
        const x = r() * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (r() - 0.5) * 10, h);
        ctx.stroke();
      }
    }),

  woodEnd: () =>
    make('wood_end', 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#c9a878';
      ctx.fillRect(0, 0, w, h);
      for (let i = 1; i < 14; i++) {
        ctx.strokeStyle = `rgba(120,80,40,${0.25 + (i % 3) * 0.1})`;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, (i * w) / 30, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(70,45,25,0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
      ctx.stroke();
    }, false),

  plaid: (a: string, b: string, c: string) =>
    make('plaid_' + a + b + c, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = b;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(i * 32 + 4, 0, 12, h);
        ctx.fillRect(0, i * 32 + 4, w, 12);
      }
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(i * 32 + 22, 0, 3, h);
        ctx.fillRect(0, i * 32 + 22, w, 3);
      }
      ctx.globalAlpha = 1;
    }),

  fabric: (color: string) =>
    make('fabric_' + color, 64, 64, (ctx, w, h, r) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
        ctx.fillRect(r() * w, r() * h, 2, 1);
        ctx.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
        ctx.fillRect(r() * w, r() * h, 1, 2);
      }
    }),

  ice: () =>
    make('ice', 256, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [196, 216, 228], 20, 2500, 3);
      for (let i = 0; i < 30; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`;
        ctx.lineWidth = 0.5 + r();
        ctx.beginPath();
        let x = r() * w, y = r() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (r() - 0.5) * 50;
          y += (r() - 0.5) * 50;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 25; i++) {
        ctx.fillStyle = `rgba(240,244,250,${0.3 + r() * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 8 + r() * 30, 4 + r() * 14, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }),

  metal: () =>
    make('metal', 64, 64, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [48, 46, 44], 20, 800, 2);
    }),

  stone: () =>
    make('stone', 128, 128, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [105, 104, 102], 40, 2500, 3);
      for (let i = 0; i < 20; i++) {
        ctx.strokeStyle = 'rgba(40,40,40,0.5)';
        ctx.strokeRect(r() * w, r() * h, 20 + r() * 30, 14 + r() * 18);
      }
    }),

  paper: () =>
    make('paper', 64, 64, (ctx, w, h, r) => {
      ctx.fillStyle = '#e8e2d2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(40,40,40,0.55)';
      for (let y = 6; y < h - 4; y += 5) {
        let x = 4;
        while (x < w - 6) {
          const len = 3 + r() * 10;
          ctx.fillRect(x, y, Math.min(len, w - 4 - x), 1.5);
          x += len + 2;
        }
      }
    }),

  label: (bg: string, fg: string, text: string) =>
    make('label_' + bg + fg + text, 128, 64, (ctx, w, h) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);
    }, false),

  frost: () =>
    make('frost', 512, 512, (ctx, w, h, r) => {
      ctx.clearRect(0, 0, w, h);
      // soft white haze towards the edges
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w * 0.72);
      g.addColorStop(0, 'rgba(220,235,255,0)');
      g.addColorStop(1, 'rgba(220,235,255,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // fern-like ice crystals growing inwards from the border
      const branch = (x: number, y: number, ang: number, len: number, depth: number, alpha: number) => {
        if (depth <= 0 || len < 2) return;
        const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        ctx.strokeStyle = `rgba(235,245,255,${alpha})`;
        ctx.lineWidth = Math.max(0.4, depth * 0.35);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const n = 2;
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1);
          const bx = x + (x2 - x) * t, by = y + (y2 - y) * t;
          branch(bx, by, ang + 0.9 + (r() - 0.5) * 0.3, len * 0.38, depth - 1, alpha * 0.8);
          branch(bx, by, ang - 0.9 + (r() - 0.5) * 0.3, len * 0.38, depth - 1, alpha * 0.8);
        }
        branch(x2, y2, ang + (r() - 0.5) * 0.5, len * 0.6, depth - 1, alpha * 0.85);
      };
      for (let i = 0; i < 70; i++) {
        const side = Math.floor(r() * 4);
        const t = r();
        const x = side === 0 ? t * w : side === 1 ? w : side === 2 ? t * w : 0;
        const y = side === 0 ? 0 : side === 1 ? t * h : side === 2 ? h : t * h;
        const ang = Math.atan2(h / 2 - y, w / 2 - x) + (r() - 0.5) * 1.2;
        branch(x, y, ang, 30 + r() * 70, 4, 0.35 + r() * 0.3);
      }
    }, false),

  flame: () =>
    make('flame', 64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,220,1)');
      g.addColorStop(0.25, 'rgba(255,200,90,0.9)');
      g.addColorStop(0.6, 'rgba(255,90,20,0.45)');
      g.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, false),

  smoke: () =>
    make('smoke', 64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(200,200,200,0.5)');
      g.addColorStop(1, 'rgba(200,200,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, false),

  flake: () =>
    make('flake', 32, 32, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, false),
  /** natural rock: layered noise, cracks, lichen (for the ground shader and boulders) */
  rock: () =>
    make('rock_nat', 256, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [112, 110, 108], 34, 5000, 3);
      for (let i = 0; i < 900; i++) {
        const v = 70 + r() * 90;
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 4},0.18)`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 4 + r() * 18, 3 + r() * 10, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // cracks as wandering lines
      for (let i = 0; i < 26; i++) {
        let x = r() * w, y = r() * h, a = r() * 6.28;
        ctx.strokeStyle = `rgba(35,33,32,${0.35 + r() * 0.35})`;
        ctx.lineWidth = 0.8 + r() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 14; k++) {
          a += (r() - 0.5) * 0.9;
          x += Math.cos(a) * 6;
          y += Math.sin(a) * 6;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // lichen
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = r() < 0.5 ? 'rgba(150,150,110,0.35)' : 'rgba(170,120,70,0.25)';
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, 1 + r() * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }),

  barkPine: () =>
    make('bark_pine', 128, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [150, 88, 52], 30, 1500, 2);
      // flaky plates
      for (let i = 0; i < 120; i++) {
        const v = r();
        ctx.fillStyle = v < 0.5 ? `rgba(110,60,34,0.6)` : `rgba(190,120,70,0.5)`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 4 + r() * 8, 8 + r() * 16, (r() - 0.5) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 50; i++) {
        ctx.strokeStyle = `rgba(60,34,20,${0.3 + r() * 0.4})`;
        ctx.lineWidth = 1 + r();
        const x = r() * w;
        ctx.beginPath();
        ctx.moveTo(x, r() * h);
        ctx.lineTo(x + (r() - 0.5) * 6, r() * h);
        ctx.stroke();
      }
    }),

  barkBurnt: () =>
    make('bark_burnt', 128, 256, (ctx, w, h, r) => {
      noiseFill(ctx, w, h, r, [26, 24, 23], 18, 1500, 2);
      // alligator cracks of charcoal
      for (let y = 0; y < h; y += 10 + r() * 6) {
        for (let x = 0; x < w; x += 9 + r() * 8) {
          const v = 10 + r() * 30;
          ctx.fillStyle = `rgb(${v},${v - 2},${v - 3})`;
          ctx.fillRect(x + 1, y + 1, 6 + r() * 5, 7 + r() * 5);
        }
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(90,80,70,${0.3 + r() * 0.3})`;
        ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 1 + r() * 2);
      }
    }),

  /** fine winter twigs on a transparent background (birch crowns, shrubs) */
  twigs: () =>
    make('twigs', 256, 256, (ctx, w, h, r) => {
      ctx.clearRect(0, 0, w, h);
      const branch = (x: number, y: number, a: number, len: number, width: number, depth: number) => {
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        ctx.strokeStyle = `rgba(${70 + depth * 8},${48 + depth * 6},${40 + depth * 5},${0.95 - depth * 0.08})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (depth < 6) {
          const n = 2 + (r() < 0.4 ? 1 : 0);
          for (let i = 0; i < n; i++) branch(x2, y2, a + (r() - 0.5) * 1.1, len * (0.62 + r() * 0.2), Math.max(0.6, width * 0.66), depth + 1);
        }
      };
      for (let k = 0; k < 5; k++) branch(w / 2 + (r() - 0.5) * 30, h, -Math.PI / 2 + (r() - 0.5) * 0.9, 52 + r() * 20, 4, 0);
      // a few clumps of snow caught in the twigs
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = 'rgba(245,248,252,0.85)';
        ctx.beginPath();
        ctx.arc(w * (0.2 + r() * 0.6), h * (0.1 + r() * 0.6), 1 + r() * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }, false),

  /** dry sedge and reed tufts on a transparent background */
  reeds: () =>
    make('reeds', 128, 128, (ctx, w, h, r) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = w * (0.2 + r() * 0.6);
        const top = h * (0.05 + r() * 0.5);
        const bend = (r() - 0.5) * 30;
        const v = r();
        ctx.strokeStyle = `rgba(${170 + v * 50},${140 + v * 40},${80 + v * 30},0.95)`;
        ctx.lineWidth = 1 + r() * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.quadraticCurveTo(x + bend * 0.3, (h + top) / 2, x + bend, top);
        ctx.stroke();
        if (r() < 0.18) {
          ctx.fillStyle = 'rgba(90,60,40,0.95)';
          ctx.fillRect(x + bend - 2, top, 4, 10);
        }
      }
    }, false),
};

// Set UVs of a BoxGeometry so textures tile by world size (texScale metres per repeat).
export function worldUVBox(w: number, h: number, d: number, texScale = 1.5): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each
  const dims: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / texScale, (uv.getY(i) * dims[f][1]) / texScale);
    }
  }
  uv.needsUpdate = true;
  return g;
}
