import * as THREE from 'three';
import { blockOrigin, BLOCK, GRID, type SceneId } from '../types';

/**
 * Ambient life: birds circling above the city, butterflies fluttering over
 * the park by day, fireflies blinking there at night. All procedural.
 */

interface Bird {
  root: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  radius: number;
  height: number;
  ang: number;
  speed: number;
  phase: number;
}

interface Butterfly {
  root: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  cx: number;
  cz: number;
  radius: number;
  ang: number;
  speed: number;
  phase: number;
}

const BIRD_N = 12;
const FLY_N = 10;
const FLY_FIREFLIES = 46;

export class Wildlife {
  readonly group = new THREE.Group();

  private birds: Bird[] = [];
  private flies: Butterfly[] = [];
  private fireflies: THREE.Points;
  private flyColors: THREE.BufferAttribute;
  /** firefly offsets relative to the park centre — replayed by setPark() */
  private fireBase: Float32Array;
  private t = 0;

  constructor() {
    const parkX = blockOrigin(Math.floor(GRID / 2)) + BLOCK / 2;
    const parkZ = blockOrigin(Math.floor(GRID / 2)) + BLOCK / 2;

    // ---- birds ----
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.9 });
    const wingGeo = new THREE.PlaneGeometry(1.1, 0.42);
    wingGeo.translate(0.55, 0, 0); // pivot at the wing root
    for (let i = 0; i < BIRD_N; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 6), bodyMat);
      body.rotation.z = -Math.PI / 2; // nose along +x
      root.add(body);
      const wingL = new THREE.Mesh(wingGeo, bodyMat);
      const wingR = new THREE.Mesh(wingGeo, bodyMat);
      wingR.rotation.y = Math.PI;
      wingL.rotation.x = -0.12;
      wingR.rotation.x = 0.12;
      root.add(wingL, wingR);
      this.group.add(root);
      this.birds.push({
        root, wingL, wingR,
        radius: 65 + ((i * 37) % 60),
        height: 42 + ((i * 53) % 34),
        ang: (i / BIRD_N) * Math.PI * 2,
        speed: 0.07 + ((i * 29) % 10) / 90,
        phase: i * 1.7,
      });
    }

    // ---- butterflies (park) ----
    const wingGeoF = new THREE.PlaneGeometry(0.17, 0.13);
    wingGeoF.translate(0.085, 0, 0);
    const flyColors2 = ['#ff7ab0', '#ffd166', '#7ad0ff', '#c08bff', '#8df2a0'];
    for (let i = 0; i < FLY_N; i++) {
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: flyColors2[i % flyColors2.length], roughness: 0.7, side: THREE.DoubleSide,
      });
      const wingL = new THREE.Mesh(wingGeoF, mat);
      const wingR = new THREE.Mesh(wingGeoF, mat);
      wingR.rotation.y = Math.PI;
      root.add(wingL, wingR);
      this.group.add(root);
      this.flies.push({
        root, wingL, wingR,
        cx: parkX, cz: parkZ,
        radius: 4 + ((i * 41) % 11),
        ang: (i / FLY_N) * Math.PI * 2,
        speed: 0.5 + ((i * 17) % 10) / 14,
        phase: i * 2.3,
      });
    }

    // ---- fireflies (park, night) ----
    const pos = new Float32Array(FLY_FIREFLIES * 3);
    const col = new Float32Array(FLY_FIREFLIES * 3);
    this.fireBase = new Float32Array(FLY_FIREFLIES * 3);
    for (let i = 0; i < FLY_FIREFLIES; i++) {
      const a = (i / FLY_FIREFLIES) * Math.PI * 2 * 3;
      const r = 3 + ((i * 31) % 130) / 10;
      this.fireBase[i * 3] = Math.cos(a) * r;
      this.fireBase[i * 3 + 1] = 0.5 + ((i * 19) % 22) / 10;
      this.fireBase[i * 3 + 2] = Math.sin(a) * r;
      pos[i * 3] = parkX + this.fireBase[i * 3];
      pos[i * 3 + 1] = this.fireBase[i * 3 + 1];
      pos[i * 3 + 2] = parkZ + this.fireBase[i * 3 + 2];
      col[i * 3] = 1;
      col[i * 3 + 1] = 1;
      col[i * 3 + 2] = 0.55;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.flyColors = new THREE.BufferAttribute(col, 3);
    geo.setAttribute('color', this.flyColors);
    this.fireflies = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.55, vertexColors: true, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })
    );
    this.fireflies.raycast = () => void 0;
    this.group.add(this.fireflies);

    this.setScene('day');
  }

  /**
   * Move the park dwellers (butterflies + fireflies) to a new park centre —
   * called after each generate/restore because the park moves with the map.
   */
  setPark(cx: number, cz: number): void {
    for (const f of this.flies) {
      f.cx = cx;
      f.cz = cz;
      f.root.position.set(cx, 1.1, cz);
    }
    const pos = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < FLY_FIREFLIES; i++) {
      arr[i * 3] = cx + this.fireBase[i * 3];
      arr[i * 3 + 1] = this.fireBase[i * 3 + 1];
      arr[i * 3 + 2] = cz + this.fireBase[i * 3 + 2];
    }
    pos.needsUpdate = true;
  }

  /** Which critters are out depends on the scene */
  setScene(id: SceneId): void {
    const day = id === 'morning' || id === 'day' || id === 'sunset' || id === 'rain';
    const night = id === 'night';
    for (const b of this.birds) b.root.visible = day;
    for (const f of this.flies) f.root.visible = day && id !== 'rain';
    this.fireflies.visible = night;
  }

  update(dt: number): void {
    this.t += dt;

    for (const b of this.birds) {
      if (!b.root.visible) continue;
      b.ang += b.speed * dt;
      const x = Math.cos(b.ang) * b.radius;
      const z = Math.sin(b.ang) * b.radius;
      const y = b.height + Math.sin(this.t * 0.7 + b.phase) * 3;
      b.root.position.set(x, y, z);
      b.root.rotation.y = -b.ang; // tangent to the circle (nose along +x)
      b.root.rotation.z = 0.35;   // bank into the turn
      const flap = Math.sin(this.t * 9 + b.phase) * 0.65;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
    }

    for (const f of this.flies) {
      if (!f.root.visible) continue;
      f.ang += f.speed * dt;
      const wob = Math.sin(this.t * 1.7 + f.phase);
      const x = f.cx + Math.cos(f.ang) * (f.radius + wob * 2);
      const z = f.cz + Math.sin(f.ang * 1.3 + f.phase) * (f.radius + wob * 2);
      const y = 1.1 + Math.sin(this.t * 2.4 + f.phase) * 0.7;
      const prevX = f.root.position.x;
      const prevZ = f.root.position.z;
      f.root.position.set(x, y, z);
      const dx = x - prevX;
      const dz = z - prevZ;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) f.root.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
      const flap = Math.sin(this.t * 22 + f.phase) * 1.1;
      f.wingL.rotation.z = flap;
      f.wingR.rotation.z = -flap;
    }

    if (this.fireflies.visible) {
      const arr = this.flyColors.array as Float32Array;
      for (let i = 0; i < FLY_FIREFLIES; i++) {
        const glow = Math.max(0, Math.sin(this.t * 1.8 + i * 1.7));
        arr[i * 3 + 1] = 0.35 + glow * 0.65;
      }
      this.flyColors.needsUpdate = true;
    }
  }
}
