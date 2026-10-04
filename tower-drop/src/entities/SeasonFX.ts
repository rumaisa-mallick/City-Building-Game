import * as THREE from 'three';

export type SeasonFXMode = 'petal' | 'leaf';

/**
 * Seasonal drift that follows the camera, like the rain/snow systems:
 * spring → cherry petals fluttering down, autumn → spinning leaves.
 * Purely cosmetic, zero assets (square-ish point sprites are fine at this
 * size — they read as petals once they flutter).
 */
export class SeasonFX {
  group = new THREE.Group();

  private geo: THREE.BufferGeometry;
  private mat: THREE.PointsMaterial;
  private speeds: Float32Array;
  private sway: Float32Array;
  private t = 0;
  private mode: SeasonFXMode;

  constructor(mode: SeasonFXMode) {
    this.mode = mode;
    const N = mode === 'petal' ? 130 : 160;
    const pos = new Float32Array(N * 3);
    this.speeds = new Float32Array(N);
    this.sway = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 220;
      pos[i * 3 + 1] = Math.random() * 55;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 220;
      this.speeds[i] = mode === 'petal' ? 1.0 + Math.random() * 1.2 : 1.7 + Math.random() * 2.1;
      this.sway[i] = Math.random() * Math.PI * 2;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: mode === 'petal' ? '#f9b3d4' : '#dd8b34',
      size: mode === 'petal' ? 0.5 : 0.7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: true,
    });
    const points = new THREE.Points(this.geo, this.mat);
    points.frustumCulled = false;
    points.raycast = () => void 0;
    this.group.add(points);
  }

  update(dt: number, camX: number, camZ: number): void {
    this.t += dt;
    this.group.position.set(camX, 0, camZ);
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const flutter = this.mode === 'petal' ? 1.8 : 1.1;
    for (let i = 0; i < this.speeds.length; i++) {
      arr[i * 3 + 1] -= this.speeds[i] * dt;
      // sideways flutter + slow spin drift
      arr[i * 3] += Math.sin(this.t * 1.1 + this.sway[i]) * dt * flutter;
      arr[i * 3 + 2] += Math.cos(this.t * 0.8 + this.sway[i]) * dt * flutter * 0.7;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 55;
        arr[i * 3] = (Math.random() - 0.5) * 220;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 220;
      }
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
