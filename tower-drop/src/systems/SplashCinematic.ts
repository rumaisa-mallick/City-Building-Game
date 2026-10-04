import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CameraSystem } from './CameraSystem';

/** The one framing the title card orbits on. */
interface Chapter {
  /** orbit distance the shot eases towards */
  radius: number;
  /** polar angle (smaller = higher, more "strategy map") */
  phi: number;
  /** orbit speed in rad/s */
  speed: number;
  /** how far the look-at point rises above where the player left it */
  lift: number;
}

// Wide enough to put skyline behind both halves of the card, low enough that the
// towers still read against the sky rather than from directly above.
const CHAPTER: Chapter = { radius: 184, phi: 1.19, speed: 0.078, lift: 11 };

/**
 * SplashCinematic — the live city is the star of the title screen.
 *
 * While `.splash` is on screen this composes a real 3D shot of the world:
 * a slow orbit with a long push-in, a gentle crane that breathes up and down,
 * and a touch of pointer parallax so the frame reacts to the player. The card
 * is a single screen, so there is deliberately one chapter only — the take
 * never cuts or re-frames part-way through.
 *
 * It is registered as an ordinary engine system, so it only ever moves while
 * the simulation is actually running — a frozen engine means a frozen camera,
 * which is exactly what the screenshot probes need. The framing the player had
 * before the splash opened is snapshotted and restored exactly on close, so
 * gameplay is never left looking at the wrong thing.
 */
export class SplashCinematic {
  private active = false;

  /** seconds since the splash opened — drives every breathing term */
  private age = 0;
  /** accumulated orbit angle; never wraps, so the shot never stutters */
  private theta = 0;
  private radius = 170;
  private phi = 1;
  private ty = 6;
  private speed = CHAPTER.speed;

  private snapS = new THREE.Spherical();
  private snapT = new THREE.Vector3();
  private hasSnap = false;

  /** smoothed pointer parallax, -1..1 */
  private par = new THREE.Vector2();
  private parGoal = new THREE.Vector2();

  private engine: Engine;
  private camera: CameraSystem;
  /** performance.now() at the previous animated frame */
  private lastMs = 0;

  constructor(engine: Engine, camera: CameraSystem) {
    this.engine = engine;
    this.camera = camera;
    // The splash covers the canvas, so InputManager never hears these —
    // listen on the window instead.
    window.addEventListener(
      'pointermove',
      (e) => {
        this.parGoal.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          (e.clientY / window.innerHeight) * 2 - 1
        );
      },
      { passive: true }
    );
  }

  update(): void {
    const now = performance.now();

    const splash = document.querySelector('.splash');
    const open = !!splash && !splash.classList.contains('hidden');

    if (open && !this.active) {
      this.enter();
      this.lastMs = now;
    } else if (!open && this.active) {
      this.leave();
      return;
    }
    if (!this.active) return;

    // Real seconds, not the engine's simulation step (which is clamped hard so
    // the city never lurches after a stall): a title shot has to track the
    // clock even when the renderer is dropping frames. The cap only stops a
    // backgrounded tab from teleporting the camera on its way back.
    const d = Math.min((now - this.lastMs) / 1000, 3);
    this.lastMs = now;
    this.age += d;

    const ch = CHAPTER;
    const k = 1 - Math.exp(-0.55 * d); // ~2s time constant: a slow, weighty glide
    this.radius += (ch.radius - this.radius) * k;
    this.phi += (ch.phi - this.phi) * k;
    this.speed += (ch.speed - this.speed) * k;
    this.ty += (this.snapT.y + ch.lift - this.ty) * k;
    this.theta += this.speed * d;
    this.par.lerp(this.parGoal, 1 - Math.exp(-2.6 * d));

    const cs = this.camera;
    // Every breathing term starts at 0, so the very first frame of the shot
    // is exactly the framing the player was already looking at — the move
    // happens over the following seconds, never in a single jump.
    cs.spherical.theta = this.theta + this.par.x * 0.1;
    cs.spherical.radius = THREE.MathUtils.clamp(
      this.radius + Math.sin(this.age * 0.21) * 18,
      cs.minDistance,
      cs.maxDistance
    );
    cs.spherical.phi = THREE.MathUtils.clamp(
      this.phi + Math.sin(this.age * 0.42) * 0.06 + this.par.y * 0.05,
      cs.minPolar,
      cs.maxPolar
    );
    cs.target.y = Math.max(0, this.ty + Math.sin(this.age * 0.13) * 3);
  }

  /** Open on a wide shot and pull back a little, so the first beat is a reveal. */
  private enter(): void {
    const cs = this.camera;
    this.snapS.copy(cs.spherical);
    this.snapT.copy(cs.target);
    this.hasSnap = true;

    this.active = true;
    this.age = 0;
    this.theta = cs.spherical.theta;
    this.radius = THREE.MathUtils.clamp(cs.spherical.radius * 1.5, 140, 430);
    this.phi = cs.spherical.phi;
    this.ty = cs.target.y;
    this.speed = CHAPTER.speed;
    this.parGoal.set(0, 0);
    this.par.set(0, 0);
  }

  /** Put the camera back exactly as it was — position included, no glide. */
  private leave(): void {
    this.active = false;
    if (!this.hasSnap) return;
    this.hasSnap = false;

    const cs = this.camera;
    cs.spherical.copy(this.snapS);
    cs.target.copy(this.snapT);
    const pos = new THREE.Vector3().setFromSpherical(this.snapS).add(this.snapT);
    this.engine.camera.position.copy(pos);
    this.engine.camera.lookAt(this.snapT);
  }
}
