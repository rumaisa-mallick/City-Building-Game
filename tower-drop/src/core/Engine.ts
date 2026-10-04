import * as THREE from 'three';
import { GameState, GameEvents } from '../types';

/**
 * Core engine - owns renderer, scene, camera and the main loop.
 * Emits events so systems can communicate without tight coupling.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clock: THREE.Clock = new THREE.Clock();

  state: GameState = 'menu';
  paused = false;

  /** When set, replaces renderer.render() each frame — used by PostFXSystem's composer. */
  renderOverride: (() => void) | null = null;

  private listeners: { [K in keyof GameEvents]?: Array<(payload: GameEvents[K]) => void> } = {};
  private systems: Array<{ update(dt: number, elapsed: number): void }> = [];
  private animationId = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed in three r186 (it silently fell back to
    // PCFShadowMap with a console warning) — use PCF + radius for soft edges
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // per-material clipping planes — drives the underground cutaway trench
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 6000);
    this.camera.position.set(10, 8, 14);
    this.camera.lookAt(0, 4, 0);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Register a system to be updated every frame */
  addSystem(system: { update(dt: number, elapsed: number): void }): void {
    this.systems.push(system);
  }

  /** Start the render loop */
  start(): void {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;

      if (!this.paused) {
        for (const s of this.systems) s.update(dt, elapsed);
      }
      if (this.renderOverride) this.renderOverride();
      else this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- Events ---

  on<K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void): void {
    (this.listeners[event] ||= []).push(handler as never);
  }

  off<K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void): void {
    const arr = this.listeners[event];
    if (!arr) return;
    const i = arr.indexOf(handler as never);
    if (i >= 0) arr.splice(i, 1);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const arr = this.listeners[event];
    if (arr) for (const h of arr) (h as (p: GameEvents[K]) => void)(payload);
  }

  /** Change game state and notify listeners */
  setState(state: GameState): void {
    const previousState = this.state;
    this.state = state;
    this.paused = state === 'paused' || state === 'menu' || state === 'mapSelect';
    this.emit('gameStateChanged', { state, previousState });
  }
}