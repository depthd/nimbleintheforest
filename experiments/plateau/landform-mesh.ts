import { Vector3 } from 'three';
import { Rng, Simplex2 } from '../../src/core/rng';

export class Surface {
  private vertices: number[] = [];
  private indices: number[] = [];
  triangle(a: Vector3, b: Vector3, c: Vector3) {
    const i = this.vertices.length / 3;
    this.vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    this.indices.push(i, i + 1, i + 2);
  }
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }
  data() {
    return { positions: Float32Array.from(this.vertices), indices: Uint32Array.from(this.indices) };
  }
}

// A single leaning ridge, continuous from its embedded root to the final point.
export function rockHorn(root: Vector3, radius: number, height: number, rng: Rng) {
  const rock = new Surface(), noise = new Simplex2(rng.next);
  const strike = rng.float(0, 2 * Math.PI), lean = radius * rng.float(.23, .57);
  const angles = Array.from({length: 11}, (_, i) => (i + rng.float(-.27, .27)) * 2 * Math.PI / 11);
  const ring = (t: number, width: number) => angles.map(a => {
    const r = radius * width * (1 + .16 * noise.noise(2 * Math.cos(a), 2 * Math.sin(a) + t * .7));
    const u = r * Math.cos(a) + lean * t, v = r * Math.sin(a) * .69;
    return root.clone().add(new Vector3(u * Math.cos(strike) - v * Math.sin(strike),
      height * (t + t * (1-t) * .28 * Math.cos(3*a)), u * Math.sin(strike) + v * Math.cos(strike)));
  });
  let lower = ring(0, 1);
  for (const [t, width] of [[.34,.82],[.73,.39]]) {
    const next = ring(t, width);
    for (let i=0; i<lower.length; i++) {
      const j=(i+1)%lower.length;
      rock.quad(lower[i], next[i], next[j], lower[j]);
    }
    lower = next;
  }
  const tip = root.clone().add(new Vector3(lean*Math.cos(strike), height, lean*Math.sin(strike)));
  lower.forEach((p,i)=>rock.triangle(p,tip,lower[(i+1)%lower.length]));
  return {rock:rock.data(), tip};
}
