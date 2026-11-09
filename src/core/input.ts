// Keyboard and mouse state with pointer lock.

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // pressed this frame
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  rmbPressed = false;
  locked = false;
  enabled = true; // false while UI modals are open
  sensitivity = 0.0022;
  private el: HTMLElement;
  private fallbackLocked = false;
  onLockChange?: (locked: boolean) => void;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (['Tab', 'F1', 'F3', 'F6'].includes(e.code)) e.preventDefault();
        return;
      }
      if (['Tab', 'F1', 'F3', 'F6', 'Space'].includes(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.lmb = true;
        this.lmbPressed = true;
      } else if (e.button === 2) {
        this.rmb = true;
        this.rmbPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      else if (e.button === 2) this.rmb = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el || this.fallbackLocked;
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if ((window as any).__test) {
      this.fallbackLocked = true;
      this.locked = true;
      this.onLockChange?.(true);
      return;
    }
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch {
      /* pointer lock not available */
    }
  }

  unlock() {
    this.fallbackLocked = false;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    } else {
      this.locked = false;
      this.onLockChange?.(false);
    }
  }

  down(code: string) {
    return this.enabled && this.keys.has(code);
  }

  hit(code: string) {
    return this.enabled && this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lmbPressed = false;
    this.rmbPressed = false;
  }
}
