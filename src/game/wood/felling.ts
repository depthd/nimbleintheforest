// When does a notched tree give way, and which way does it fall?
//
// The stem above a cut presses on what is left of the cross-section. Its weight acts
// at the centre of mass, which sits off the remaining wood: the tree leans a little,
// the wind pushes the crown, and the notch moved the remaining wood away from the
// axis. That offset times the weight is a bending moment; together with the weight
// it gives the stress at the edge of the remaining wood. When the stress passes what
// green wood can take, the tree tips over the edge (the hinge) toward the offset.
//
// So a single notch makes the tree fall toward it, a face notch on the lean side and
// a back cut from the other side drop it where you want, and a tree that leans the
// other way sits back on the cut and falls toward you.
//
// Directions here are in the stem's cross-section plane (local y, z).
import { bendingAt, radiusAt, sectionAt, weakestAt, whorlMass, WoodPiece } from './piece';
import { density, SPECIES } from './species';

export interface FellInput {
  stem: WoodPiece;
  /** horizontal shift of the axis per metre of height: tan(lean) toward the lean side */
  leanY: number;
  leanZ: number;
  /** wind force on the crown, N */
  windY: number;
  windZ: number;
  /** height of the crown's centre of pressure, m above the base */
  windH: number;
  moisture: number;
}

export interface FellState {
  /** stress over strength: the tree goes at 1 */
  ratio: number;
  /** height of the weakest section */
  u: number;
  /** direction it would fall */
  dirY: number;
  dirZ: number;
  /** the hinge: edge of the remaining wood on the fall side, from the axis */
  hingeY: number;
  hingeZ: number;
  /** what remains of the section there */
  frac: number;
}

/** Wood can't take its full short-term strength through torn, notched fibres. */
export const FAIL_STRENGTH = 0.45;
const g = 9.81;

/** Weight above a height and how high its centre of mass sits above it. */
export function loadAbove(stem: WoodPiece, u: number, moisture: number) {
  const rho = density(stem.sp, moisture);
  const n = 12;
  const h = (stem.len - u) / n;
  let m = 0, mu = 0;
  for (let i = 0; i < n; i++) {
    const x = u + (i + 0.5) * h;
    const r = radiusAt(stem, x);
    const dm = Math.PI * r * r * h * rho;
    m += dm;
    mu += dm * x;
  }
  for (const w of stem.whorls) {
    if (w.u <= u) continue;
    const wm = whorlMass(w, stem.sp, moisture);
    m += wm;
    mu += wm * w.u;
  }
  return { mass: m, com: m > 0 ? mu / m - u : 0 };
}

export function fellCheck(f: FellInput): FellState {
  const stem = f.stem;
  let best: FellState = { ratio: 0, u: 0, dirY: f.leanY, dirZ: f.leanZ, hingeY: 0, hingeZ: 0, frac: 1 };
  const l0 = Math.hypot(f.leanY, f.leanZ);
  if (l0 > 0) {
    best.dirY /= l0;
    best.dirZ /= l0;
  } else best.dirY = 1;
  const strength = SPECIES[stem.sp].mor * 1e6 * FAIL_STRENGTH;
  for (const n of stem.notches) {
    if (n.done) continue;
    const u = weakestAt(stem, n);
    const sec = sectionAt(stem, u);
    const { mass, com } = loadAbove(stem, u, f.moisture);
    const W = mass * g;
    if (W <= 0) continue;
    // where the weight acts, relative to the centre of the remaining wood
    const arm = Math.max(0, f.windH - u);
    let ey = f.leanY * com + (f.windY * arm) / W - sec.cy;
    let ez = f.leanZ * com + (f.windZ * arm) / W - sec.cz;
    let e = Math.hypot(ey, ez);
    if (e < 1e-6) {
      ey = best.dirY * 1e-6;
      ez = best.dirZ * 1e-6;
      e = 1e-6;
    }
    const my = ey / e, mz = ez / e;
    const b = bendingAt(stem, u, my, mz);
    const sigma = b.area > 0 && b.S > 0 ? W / b.area + (W * e) / b.S : Infinity;
    const ratio = sigma / strength;
    if (ratio > best.ratio) {
      best = { ratio, u, dirY: my, dirZ: mz, hingeY: b.cy + my * b.edge, hingeZ: b.cz + mz * b.edge, frac: sec.frac };
    }
  }
  return best;
}
