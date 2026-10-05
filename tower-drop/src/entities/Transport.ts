import * as THREE from 'three';
import { GRID, ROAD, roadCenter } from '../types';
import { makeRng } from '../utils/textures';
import { bodyColors } from './Vehicle';

export type StreetKind = 'parking' | 'bike';

/**
 * Street usage: k = 1 and k = 4 carry the bus ring (buses are 2.4 m wide —
 * no curb parking there), k = 3 is the midtown bike corridor; the other
 * streets (0, 2, 5) park at the curb. Same scheme on both axes so parking
 * blocks and bike corridors interleave across the grid.
 */
export function streetKind(axis: 'x' | 'z', k: number): StreetKind {
  return k === 1 || k === 3 || k === 4 ? 'bike' : 'parking';
}

/** A static car sitting in a curb parking slot (no lights — it isn't going anywhere). */
function createParkedCar(seed: number, forceColor?: string): THREE.Group {
  const r = makeRng(seed);
  const g = new THREE.Group();
  const color = forceColor ?? bodyColors[Math.floor(r() * bodyColors.length)];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#182530', roughness: 0.1, metalness: 0.8 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.85, 1.85), bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 1.7), glassMat);
  cabin.position.set(-0.25, 1.32, 0);
  cabin.castShadow = true;
  g.add(cabin);
  for (const [wx, wz] of [[-1.35, -0.95], [1.35, -0.95], [-1.35, 0.95], [1.35, 0.95]] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    g.add(wheel);
  }
  g.userData.kind = 'parked';
  return g;
}

/** Yellow TAXI plate for the stand sign (procedural canvas, like facility signs). */
function taxiPlateMat(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2c21b';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#141414';
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TAXI', 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
}

/**
 * Static street furniture, built once alongside the roads:
 *  - green painted bike lanes down both shoulders of bike streets
 *  - parallel-parked cars along the curbs of parking streets
 *  - two taxi stands (sign on the sidewalk, waiting yellow cab at the curb)
 */
export function buildStreetFurniture(): THREE.Group {
  const root = new THREE.Group();
  const r = makeRng(4242);

  const laneMat = new THREE.MeshStandardMaterial({ color: '#1f9e57', roughness: 0.88 });

  // stands sit mid-block on parking streets (vertical k=2, horizontal k=2);
  // nx/nz point from cab toward the sidewalk
  const stands = [
    { x: roadCenter(2) + 5, z: (roadCenter(1) + roadCenter(2)) / 2, yaw: Math.PI / 2, nx: 1, nz: 0 },
    { x: (roadCenter(3) + roadCenter(4)) / 2, z: roadCenter(2) + 5, yaw: 0, nx: 0, nz: 1 },
  ];

  const gap = ROAD / 2 + 8.5; // stay clear of junctions, crosswalks & signal poles

  for (const axis of ['z', 'x'] as const) {
    for (let k = 0; k <= GRID; k++) {
      const center = roadCenter(k);
      const kind = streetKind(axis, k);
      for (let j = 0; j < GRID; j++) {
        const a0 = roadCenter(j) + gap;
        const a1 = roadCenter(j + 1) - gap;
        if (a1 - a0 < 10) continue;
        const mid = (a0 + a1) / 2;
        const len = a1 - a0;

        if (kind === 'bike') {
          // green paint down both shoulders
          for (const side of [-1, 1]) {
            const off = center + side * 4.8;
            const geo = axis === 'z'
              ? new THREE.BoxGeometry(1.15, 0.03, len)
              : new THREE.BoxGeometry(len, 0.03, 1.15);
            const strip = new THREE.Mesh(geo, laneMat);
            strip.position.set(axis === 'z' ? off : mid, 0.035, axis === 'z' ? mid : off);
            strip.receiveShadow = true;
            strip.userData.kind = 'bikeLane';
            root.add(strip);
          }
        } else {
          // parallel parking at both curbs (spacing leaves realistic gaps)
          for (const side of [-1, 1]) {
            const cross = center + side * 5.0;
            for (let t = a0 + 2; t <= a1 - 2; t += 8) {
              if (r() > 0.62) continue;
              const sx = axis === 'z' ? cross : t;
              const sz = axis === 'z' ? t : cross;
              if (stands.some((s) => Math.hypot(s.x - sx, s.z - sz) < 8)) continue;
              const car = createParkedCar(Math.floor(r() * 1e6));
              if (axis === 'z') {
                car.position.set(cross, 0, t);
                // east shoulder runs northbound, west shoulder southbound
                car.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
              } else {
                car.position.set(t, 0, cross);
                // south shoulder runs eastbound, north shoulder westbound
                car.rotation.y = side === 1 ? 0 : Math.PI;
              }
              root.add(car);
            }
          }
        }
      }
    }
  }

  // taxi stands: pole + plate on the sidewalk, a waiting yellow cab at the curb
  for (let i = 0; i < stands.length; i++) {
    const s = stands[i];
    const stand = new THREE.Group();
    stand.position.set(s.x, 0, s.z);
    stand.userData.kind = 'taxiStand';

    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.5 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.3, 8), poleMat);
    pole.position.set(s.nx * 2.6, 1.15, s.nz * 2.6);
    pole.castShadow = true;
    stand.add(pole);

    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), taxiPlateMat());
    plate.position.set(s.nx * 2.6, 2.4, s.nz * 2.6);
    plate.rotation.y = s.nx === 1 ? -Math.PI / 2 : Math.PI; // face the street
    stand.add(plate);

    const cab = createParkedCar(7000 + i, '#f2c21b');
    cab.rotation.y = s.yaw;
    stand.add(cab);

    root.add(stand);
  }

  return root;
}
