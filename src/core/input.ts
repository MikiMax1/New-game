// Keyboard and mouse state, polled once per frame. Keys use KeyboardEvent.code so
// controls work the same on every keyboard layout.

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** True while the pointer is locked to the canvas (mouse-look active). */
  locked = false;

  constructor(private readonly element: HTMLElement, allowPointerLock: boolean) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'F3' || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    if (allowPointerLock) {
      element.addEventListener('click', () => {
        if (!this.locked) void element.requestPointerLock?.();
      });
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === element;
      });
    }
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  releasePointer(): void {
    if (this.locked) document.exitPointerLock();
  }

  get target(): HTMLElement {
    return this.element;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
