import * as THREE from 'three';
import { InputManager } from '../core/InputManager';
import { TOTAL } from '../types';

/**
 * Orbit + pan + zoom camera with smooth damping.
 * Right-drag = orbit, Shift+right-drag = pan, Q/E = rotate, wheel = zoom, WASD or screen edge = pan.
 */
export class CameraSystem {
  private camera: THREE.PerspectiveCamera;
  private input: InputManager;

  target = new THREE.Vector3(0, 6, 0);
  spherical = new THREE.Spherical(190, 1.02, 0.7);
  minDistance = 6;
  maxDistance = 560;
  minPolar = 0.1;
  maxPolar = Math.PI / 2.1;

  private desired = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private rotateSpeed = 2.4;
  private panSpeed = 12;
  private edgeZone = 0.94; // pointer NDC past this counts as pushing the edge
  private zoomSpeed = 0.1;
  private smooth = 8;

  constructor(camera: THREE.PerspectiveCamera, input: InputManager) {
    this.camera = camera;
    this.input = input;

    this.desired.copy(this.sphericalToPos(this.spherical));
    this.desiredTarget.copy(this.target);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.target);
  }

  private sphericalToPos(s: THREE.Spherical): THREE.Vector3 {
    const v = new THREE.Vector3();
    v.setFromSpherical(s);
    return v.clone().add(this.target);
  }

  update(dt: number): void {
    const i = this.input;

    // Rotate with middle mouse drag or Q/E keys
    const middleDrag = i.mouseButtons.has(1) || i.mouseButtons.has(2) && !i.keys.has('ShiftLeft');
    const rightPan = i.mouseButtons.has(2);

    if (middleDrag) {
      // approximate drag delta from mouse NDC
      this.spherical.theta -= i.mouse.x * dt * this.rotateSpeed;
      this.spherical.phi -= i.mouse.y * dt * this.rotateSpeed;
    }

    if (i.isKeyDown('KeyQ')) this.spherical.theta += dt * this.rotateSpeed * 0.8;
    if (i.isKeyDown('KeyE')) this.spherical.theta -= dt * this.rotateSpeed * 0.8;

    // Zoom with wheel
    if (i.wheelDelta !== 0) {
      this.spherical.radius *= 1 + i.wheelDelta * this.zoomSpeed * 0.05;
    }

    // Pan with WASD, screen edges or right-drag (screen-aligned)
    const pan = new THREE.Vector3();
    if (i.isKeyDown('KeyW')) pan.z -= 1;
    if (i.isKeyDown('KeyS')) pan.z += 1;
    if (i.isKeyDown('KeyA')) pan.x -= 1;
    if (i.isKeyDown('KeyD')) pan.x += 1;
    const fromKeys = pan.lengthSq() > 0;

    // Push the pointer against a screen edge to drift that way; the ramp keeps
    // a light touch crawling and puts a corner at full key speed
    let edgeStrength = 0;
    if (i.edgeActive && i.mouseButtons.size === 0) {
      const ramp = (v: number): number => {
        const a = Math.abs(v);
        return a < this.edgeZone ? 0 : (Math.sign(v) * (a - this.edgeZone)) / (1 - this.edgeZone);
      };
      const ex = ramp(i.edgeX);
      const ey = ramp(i.edgeY);
      pan.x += ex;
      pan.z -= ey; // screen up = forward, same sign as W
      edgeStrength = Math.min(1, Math.hypot(ex, ey));
    }

    if (pan.lengthSq() > 0) {
      const speed = (fromKeys ? 1 : edgeStrength) * this.panSpeed;
      pan.normalize().multiplyScalar(speed * dt);
      // convert pan to camera-relative
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      this.target.addScaledVector(right, pan.x);
      this.target.addScaledVector(forward, -pan.z);
    }

    if (rightPan && !middleDrag) {
      const panAmount = 0.05 * this.spherical.radius;
      this.target.x -= i.mouse.x * panAmount;
      this.target.y += i.mouse.y * panAmount * 0.6;
    }

    // Clamp
    this.spherical.radius = THREE.MathUtils.clamp(this.spherical.radius, this.minDistance, this.maxDistance);
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, this.minPolar, this.maxPolar);
    this.target.y = Math.max(0, this.target.y);
    const panLimit = TOTAL / 2 + 60;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -panLimit, panLimit);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -panLimit, panLimit);

    // Smooth follow
    const desiredPos = this.sphericalToPos(this.spherical);
    this.desired.copy(desiredPos);
    this.desiredTarget.copy(this.target);

    const lerpFactor = 1 - Math.exp(-this.smooth * dt);
    this.camera.position.lerp(this.desired, lerpFactor);
    this.camera.lookAt(this.desiredTarget);
  }

  /** Snap camera to focus on tower height */
  focusOn(height: number): void {
    this.target.set(0, height / 2, 0);
    this.spherical.radius = Math.max(16, height * 1.4);
  }
}