import * as THREE from 'three';

/**
 * Centralized input handling: keyboard, mouse, wheel.
 * Provides world-space mouse position via raycasting.
 */
export class InputManager {
  readonly mouse = new THREE.Vector2();       // NDC coords -1..1
  readonly mouseWorld = new THREE.Vector3();  // world hit point
  readonly keys = new Set<string>();
  readonly mouseButtons = new Set<number>();
  wheelDelta = 0;
  /** True on the frame a key was pressed */
  readonly keysPressed = new Set<string>();

  private rotating = false;
  private lastRotX = 0;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private target: HTMLElement;
  private camera: THREE.Camera;

  onPlace: (() => void) | null = null;       // left click
  onRotate: (() => void) | null = null;      // R or wheel while holding
  onToggleGrid: (() => void) | null = null;  // G
  onToggleHanging: (() => void) | null = null; // H
  onUndo: (() => void) | null = null;        // Ctrl+Z
  onSave: (() => void) | null = null;        // Ctrl+S
  onLoad: (() => void) | null = null;        // Ctrl+O
  onMapSelect: (() => void) | null = null;   // M
  onHotkey: ((key: string) => void) | null = null; // 1-9 block palette
  /** 'mouse' = right-click (tool cancel only), 'key' = Esc (idle → pause) */
  onCancel: ((src: 'mouse' | 'key') => void) | null = null;
  onPause: (() => void) | null = null;        // P — pause toggle
  onPhoto: (() => void) | null = null;        // F — photo mode (hide the HUD)
  onNews: (() => void) | null = null;         // N — city newspaper
  onCutaway: (() => void) | null = null;      // X — underground cutaway
  onDigitPressed: ((n: number) => void) | null = null;
  /** Shift + left-drag: continuous mouse rotation of the element being placed (dx in px) */
  onRotateDelta: ((dx: number) => void) | null = null;
  /** Screen-edge panning: pointer in NDC plus its gate — tracked at window
   *  level because HUD panels swallow the canvas's own pointermove */
  edgeX = 0;
  edgeY = 0;
  edgeActive = false;

  constructor(target: HTMLElement, camera: THREE.Camera) {
    this.target = target;
    this.camera = camera;
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.keysPressed.add(e.code);
      this.keys.add(e.code);
      this.handleKey(e);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    this.target.addEventListener('pointerdown', (e) => {
      this.mouseButtons.add(e.button);
      if (e.button === 0) {
        if (e.shiftKey) {
          // Shift + left-drag: rotate the element instead of placing it
          this.rotating = true;
          this.lastRotX = e.clientX;
        } else {
          this.onPlace?.();
        }
      }
      if (e.button === 2) this.onCancel?.('mouse');
    });

    this.target.addEventListener('pointerup', (e) => {
      this.mouseButtons.delete(e.button);
      if (e.button === 0) this.rotating = false;
    });

    this.target.addEventListener('pointermove', (e) => {
      this.updateMouseCoords(e.clientX, e.clientY);
      if (this.rotating && this.mouseButtons.has(0)) {
        const dx = e.clientX - this.lastRotX;
        this.lastRotX = e.clientX;
        if (dx !== 0) this.onRotateDelta?.(dx);
      }
    });

    this.target.addEventListener('wheel', (e) => {
      if (e.shiftKey) {
        // Shift + wheel: rotate the element in 90° steps (no zoom)
        this.onRotate?.();
      } else {
        this.wheelDelta = e.deltaY;
      }
      e.preventDefault();
    }, { passive: false });

    this.target.addEventListener('contextmenu', (e) => e.preventDefault());

    this.target.addEventListener('pointerleave', () => {
      this.mouseButtons.clear();
      this.rotating = false;
    });

    // Edge-pan state follows the pointer at window level: over HUD panels the
    // canvas sees no pointermove, but the view still has to know the pointer
    // is near an edge. Only the city itself and the edge-hugging bars count —
    // over controls and panels the view must hold still.
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.edgeX = (e.clientX / window.innerWidth) * 2 - 1;
      this.edgeY = -(e.clientY / window.innerHeight) * 2 + 1;
      const el = e.target;
      if (!(el instanceof Element)) {
        this.edgeActive = false;
        return;
      }
      const onControl = el.closest('button, input, select, textarea, label, a[href]');
      this.edgeActive =
        !onControl && (el === this.target || !!el.closest('.hud-top, .help'));
    });

    // leaving the window freezes the pointer at the edge it exited through —
    // without clearing the gate the camera would drift on its own
    window.addEventListener('blur', () => {
      this.edgeActive = false;
    });
    document.documentElement.addEventListener('mouseleave', () => {
      this.edgeActive = false;
    });
  }

  private handleKey(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.code === 'KeyZ') { this.onUndo?.(); e.preventDefault(); return; }
    if (ctrl && e.code === 'KeyS') { this.onSave?.(); e.preventDefault(); return; }
    if (ctrl && e.code === 'KeyO') { this.onLoad?.(); e.preventDefault(); return; }

    switch (e.code) {
      case 'KeyR': this.onRotate?.(); break;
      case 'KeyG': this.onToggleGrid?.(); break;
      case 'KeyH': this.onToggleHanging?.(); break;
      case 'KeyM': this.onMapSelect?.(); break;
      case 'KeyP': this.onPause?.(); break;
      case 'KeyF': this.onPhoto?.(); break;
      case 'KeyN': this.onNews?.(); break;
      case 'KeyX': this.onCutaway?.(); break;
      case 'Escape': this.onCancel?.('key'); break;
      default:
        if (e.code.startsWith('Digit')) {
          const n = parseInt(e.code.replace('Digit', ''), 10);
          if (!isNaN(n)) {
            this.onDigitPressed?.(n);
            this.onHotkey?.(e.key);
          }
        }
    }
  }

  private updateMouseCoords(clientX: number, clientY: number): void {
    this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    // Project onto the placement plane
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.graycastGround();
  }

  private graycastGround(): void {
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.mouseWorld);
    if (!hit) {
      // fallback: project at a fixed distance
      this.raycaster.ray.at(20, this.mouseWorld);
    }
  }

  /** Raycast against a set of objects (blocks) */
  raycastObjects(objects: THREE.Object3D[]): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster.intersectObjects(objects, false);
  }

  /** Update the ground plane height (for stacking) */
  setPlaneHeight(y: number): void {
    this.groundPlane.constant = -y;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Clear per-frame state - call at end of frame */
  endFrame(): void {
    this.keysPressed.clear();
    this.wheelDelta = 0;
  }
}