import * as THREE from 'three';
import { GRID, ROAD, PITCH, ORIGIN, roadCenter } from '../types';

const DUR = [9, 1.4, 9, 1.4]; // x-green, x-yellow, z-green, z-yellow
// states: 0 = x green, 1 = x yellow, 2 = z green, 3 = z yellow

type Axis = 'x' | 'z';

interface LampMats {
  red: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
}

interface PedMats {
  red: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
}

/**
 * Traffic lights at every inner intersection of the road grid.
 * Two phase groups (checkerboard parity) alternate N-S / E-W flow, so
 * crossing streets never go green at the same time. Cars and buses query
 * canGo()/nextSignalStop() to brake for red lights.
 */
export class TrafficSystem {
  readonly group = new THREE.Group();

  private states: [number, number] = [0, 2]; // group 0 starts x-green, group 1 z-green
  private timers: [number, number] = [0, 0];
  private mats: [Record<Axis, LampMats>, Record<Axis, LampMats>];
  private pedMats: [Record<Axis, PedMats>, Record<Axis, PedMats>];

  constructor() {
    const mk = (color: string, emissive: string): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0, roughness: 0.5 });

    this.mats = [
      {
        x: { red: mk('#57120f', '#ff2a22'), yellow: mk('#5a4a10', '#ffcc22'), green: mk('#0d3f1c', '#2aff6a') },
        z: { red: mk('#57120f', '#ff2a22'), yellow: mk('#5a4a10', '#ffcc22'), green: mk('#0d3f1c', '#2aff6a') },
      },
      {
        x: { red: mk('#57120f', '#ff2a22'), yellow: mk('#5a4a10', '#ffcc22'), green: mk('#0d3f1c', '#2aff6a') },
        z: { red: mk('#57120f', '#ff2a22'), yellow: mk('#5a4a10', '#ffcc22'), green: mk('#0d3f1c', '#2aff6a') },
      },
    ];

    // pedestrian heads: WALK while the road that pole controls is fully red
    this.pedMats = [
      { x: { red: mk('#4a1412', '#ff2a22'), green: mk('#0d3f1c', '#2aff6a') },
        z: { red: mk('#4a1412', '#ff2a22'), green: mk('#0d3f1c', '#2aff6a') } },
      { x: { red: mk('#4a1412', '#ff2a22'), green: mk('#0d3f1c', '#2aff6a') },
        z: { red: mk('#4a1412', '#ff2a22'), green: mk('#0d3f1c', '#2aff6a') } },
    ];

    // poles at inner intersections (edge roads stay uncontrolled)
    for (let kx = 1; kx <= GRID - 1; kx++) {
      for (let kz = 1; kz <= GRID - 1; kz++) {
        const ix = roadCenter(kx);
        const iz = roadCenter(kz);
        const group = ((kx + kz) % 2) as 0 | 1;
        const off = ROAD / 2 + 1.6;
        this.addSignal(group, 'x', +off, +off, ix, iz); // NE corner → x traffic
        this.addSignal(group, 'z', -off, -off, ix, iz); // SW corner → z traffic
      }
    }

    this.applyState(0);
    this.applyState(1);
  }

  private addSignal(group: 0 | 1, axis: Axis, ox: number, oz: number, ix: number, iz: number): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2e3136', roughness: 0.55, metalness: 0.5 });
    const px = ix + ox;
    const pz = iz + oz;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 10), poleMat);
    base.position.set(px, 0.15, pz);
    this.group.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), poleMat);
    pole.position.set(px, 2.9, pz);
    pole.castShadow = true;
    this.group.add(pole);

    const headMat = new THREE.MeshStandardMaterial({ color: '#17181c', roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.3, 0.44), headMat);
    head.position.set(px, 5.1, pz);
    head.castShadow = true;
    this.group.add(head);

    // lamps face the intersection center
    const ux = -Math.sign(ox);
    const uz = -Math.sign(oz);
    const mats = this.mats[group][axis];
    const spots: Array<[number, THREE.MeshStandardMaterial]> = [
      [0.36, mats.red],
      [0.0, mats.yellow],
      [-0.36, mats.green],
    ];
    for (const [dy, mat] of spots) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat);
      lamp.position.set(px + ux * 0.26, 5.1 + dy, pz + uz * 0.26);
      this.group.add(lamp);
    }

    // pedestrian head lower on the pole: two dots, red = don't cross
    const pedBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.5, 0.26),
      new THREE.MeshStandardMaterial({ color: '#17181c', roughness: 0.7 })
    );
    pedBox.position.set(px + ux * 0.16, 3.4, pz + uz * 0.16);
    pedBox.castShadow = true;
    this.group.add(pedBox);
    const pm = this.pedMats[group][axis];
    const pedRed = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), pm.red);
    pedRed.position.set(px + ux * 0.31, 3.53, pz + uz * 0.31);
    const pedGreen = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), pm.green);
    pedGreen.position.set(px + ux * 0.31, 3.27, pz + uz * 0.31);
    this.group.add(pedRed, pedGreen);
  }

  /** Toggle lamp emissives for a phase group */
  private applyState(g: 0 | 1): void {
    const s = this.states[g];
    const set = (axis: Axis, r: boolean, y: boolean, gr: boolean): void => {
      const m = this.mats[g][axis];
      m.red.emissiveIntensity = r ? 2.2 : 0;
      m.yellow.emissiveIntensity = y ? 2.2 : 0;
      m.green.emissiveIntensity = gr ? 2.4 : 0;
      // pedestrians may cross only while this road is fully red
      const walk = !r && !y;
      const pm = this.pedMats[g][axis];
      pm.green.emissiveIntensity = walk ? 2.0 : 0;
      pm.red.emissiveIntensity = walk ? 0 : 2.0;
    };
    set('x', s >= 2, s === 1, s === 0);
    set('z', s <= 1, s === 3, s >= 2);
  }

  /** May traffic on `axis` enter the crossing at world point (ix, iz)? */
  canGo(axis: Axis, ix: number, iz: number): boolean {
    const kx = Math.round((ix - ORIGIN - ROAD / 2) / PITCH);
    const kz = Math.round((iz - ORIGIN - ROAD / 2) / PITCH);
    if (kx < 1 || kx > GRID - 1 || kz < 1 || kz > GRID - 1) return true; // uncontrolled edge road
    const s = this.states[(kx + kz) % 2];
    return axis === 'x' ? s <= 1 : s >= 2;
  }

  update(dt: number): void {
    for (const g of [0, 1] as const) {
      this.timers[g] += dt;
      if (this.timers[g] >= DUR[this.states[g]]) {
        this.timers[g] -= DUR[this.states[g]];
        this.states[g] = (this.states[g] + 1) % 4;
        this.applyState(g);
      }
    }
  }
}

/**
 * Distance to the next red stop line ahead of a vehicle (Infinity = clear).
 * `t` is the position along the travel axis; `ownCenter` the road center
 * the vehicle is driving on (its cross-coordinate).
 */
export function nextSignalStop(
  traffic: TrafficSystem | null | undefined,
  axis: Axis,
  dir: 1 | -1,
  t: number,
  ownCenter: number,
  look = 75
): number {
  if (!traffic) return Infinity;
  let best = Infinity;
  for (let k = 1; k <= GRID - 1; k++) {
    const cross = roadCenter(k);
    const ahead = (cross - t) * dir;
    if (ahead < 0 || ahead > look) continue;
    const d = (cross - dir * (ROAD / 2 + 3.5) - t) * dir; // stop line distance
    if (d < -1.5) continue;
    const ix = axis === 'x' ? cross : ownCenter;
    const iz = axis === 'x' ? ownCenter : cross;
    if (!traffic.canGo(axis, ix, iz)) best = Math.min(best, d);
  }
  return best;
}
