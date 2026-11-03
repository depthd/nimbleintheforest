// Binary min-heap of (float key, int value) pairs, used by the flood fill.
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(cap = 1024) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }

  push(k: number, v: number) {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2);
      nk.set(this.keys);
      const nv = new Int32Array(this.vals.length * 2);
      nv.set(this.vals);
      this.keys = nk;
      this.vals = nv;
    }
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = k;
    V[i] = v;
  }

  /** key of the smallest element */
  peekKey() {
    return this.keys[0];
  }

  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    const n = --this.size;
    if (n > 0) {
      const k = K[n], v = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= k) break;
        K[i] = K[c];
        V[i] = V[c];
        i = c;
      }
      K[i] = k;
      V[i] = v;
    }
    return top;
  }
}
