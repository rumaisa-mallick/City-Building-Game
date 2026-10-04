import * as THREE from 'three';
import { TOTAL } from '../types';
import { registerWettable } from '../utils/materialRegistry';
import { makeRng } from '../utils/textures';

// ============================================================================
// Railway: a rounded-rectangle loop ringing the city, plus trains that run it.
//
// The loop is sampled analytically (4 straights + 4 quarter-circles) so trains
// can query position/heading at any distance along the track each frame.
// ============================================================================

interface SegLine { kind: 'l'; x0: number; z0: number; x1: number; z1: number; len: number }
interface SegArc { kind: 'a'; cx: number; cz: number; r: number; a0: number; a1: number; len: number }
type Seg = SegLine | SegArc;

function buildSegs(H: number, R: number): Seg[] {
  const line = (x0: number, z0: number, x1: number, z1: number): SegLine => ({
    kind: 'l', x0, z0, x1, z1, len: Math.hypot(x1 - x0, z1 - z0),
  });
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number): SegArc => ({
    kind: 'a', cx, cz, r, a0, a1, len: r * (a1 - a0),
  });
  return [
    line(-H + R, -H, H - R, -H),
    arc(H - R, -(H - R), R, -Math.PI / 2, 0),
    line(H, -(H - R), H, H - R),
    arc(H - R, H - R, R, 0, Math.PI / 2),
    line(H - R, H, -H + R, H),
    arc(-(H - R), H - R, R, Math.PI / 2, Math.PI),
    line(-H, H - R, -H, -(H - R)),
    arc(-(H - R), -(H - R), R, Math.PI, Math.PI * 1.5),
  ];
}

function posIn(seg: Seg, t: number): { x: number; z: number } {
  if (seg.kind === 'l') {
    return { x: seg.x0 + (seg.x1 - seg.x0) * t, z: seg.z0 + (seg.z1 - seg.z0) * t };
  }
  const a = seg.a0 + (seg.a1 - seg.a0) * t;
  return { x: seg.cx + seg.r * Math.cos(a), z: seg.cz + seg.r * Math.sin(a) };
}

const RAIL_H = 0.30;       // rail head height above ground
const SLEEPER_GAP = 1.3;   // metres between sleepers

export class RailLoop {
  readonly length: number;
  readonly half: number;
  private pts: Float32Array;   // x,z pairs, closed loop
  private n: number;

  constructor() {
    this.half = TOTAL / 2 + 20;      // ring outside the road grid
    const R = 26;                    // corner radius
    const segs = buildSegs(this.half, R);
    const total = segs.reduce((s, g) => s + g.len, 0);
    this.length = total;
    this.n = Math.max(64, Math.round(total)); // ~1m resolution
    this.pts = new Float32Array(this.n * 2);

    let acc = 0;
    let seg = 0;
    for (let i = 0; i < this.n; i++) {
      const target = (i / this.n) * total;
      while (seg < segs.length - 1 && acc + segs[seg].len < target) {
        acc += segs[seg].len;
        seg++;
      }
      const t = Math.min(1, Math.max(0, (target - acc) / segs[seg].len));
      const p = posIn(segs[seg], t);
      this.pts[i * 2] = p.x;
      this.pts[i * 2 + 1] = p.z;
    }
  }

  posAt(s: number): { x: number; z: number } {
    const L = this.length;
    s = ((s % L) + L) % L;
    const fi = (s / L) * this.n;
    const i0 = Math.floor(fi) % this.n;
    const i1 = (i0 + 1) % this.n;
    const f = fi - Math.floor(fi);
    return {
      x: this.pts[i0 * 2] + (this.pts[i1 * 2] - this.pts[i0 * 2]) * f,
      z: this.pts[i0 * 2 + 1] + (this.pts[i1 * 2 + 1] - this.pts[i0 * 2 + 1]) * f,
    };
  }

  headingAt(s: number): number {
    const a = this.posAt(s - 0.75);
    const b = this.posAt(s + 0.75);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Sample point on the loop nearest to (x,z) */
  closest(x: number, z: number): { s: number; x: number; z: number; dist: number } {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = this.pts[i * 2] - x;
      const dz = this.pts[i * 2 + 1] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    const s = (best / this.n) * this.length;
    const p = this.posAt(s);
    return { s, x: p.x, z: p.z, dist: Math.hypot(x - p.x, z - p.z) };
  }

  private vecs(offset: number, y: number): THREE.Vector3[] {
    // offset laterally along the outward normal at every sample
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n;
      const hx = this.pts[j * 2] - this.pts[i * 2];
      const hz = this.pts[j * 2 + 1] - this.pts[i * 2 + 1];
      const hl = Math.hypot(hx, hz) || 1;
      // outward normal for a loop walked this way (right-hand side)
      const nx = -hz / hl;
      const nz = hx / hl;
      // pick the outward direction: points away from origin
      const px = this.pts[i * 2];
      const pz = this.pts[i * 2 + 1];
      const flip = px * nx + pz * nz < 0 ? -1 : 1;
      out.push(new THREE.Vector3(px + nx * offset * flip, y, pz + nz * offset * flip));
    }
    return out;
  }

  /** Ballast, sleepers, rails and signals — added to the city as scenery */
  buildMeshes(): THREE.Group {
    const g = new THREE.Group();

    // ballast bed: wide flattened tube along the centreline
    const bedCurve = new THREE.CatmullRomCurve3(this.vecs(0, 0), true, 'catmullrom', 0.02);
    const bedGeo = new THREE.TubeGeometry(bedCurve, 500, 1.9, 8, true);
    bedGeo.scale(1, 0.16, 1);
    const bedMat = new THREE.MeshStandardMaterial({ color: '#76716a', roughness: 1 });
    registerWettable(bedMat);
    const bed = new THREE.Mesh(bedGeo, bedMat);
    bed.position.y = -0.14;
    bed.receiveShadow = true;
    g.add(bed);

    // sleepers (one instanced draw call)
    const count = Math.floor(this.length / SLEEPER_GAP);
    const sleeperGeo = new THREE.BoxGeometry(2.6, 0.14, 0.34);
    const sleeperMat = new THREE.MeshStandardMaterial({ color: '#4b3a2a', roughness: 0.95 });
    const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMat, count);
    sleepers.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const s = (i / count) * this.length;
      const p = this.posAt(s);
      const h = this.headingAt(s);
      q.setFromAxisAngle(up, h);
      m.compose(new THREE.Vector3(p.x, 0.2, p.z), q, new THREE.Vector3(1, 1, 1));
      sleepers.setMatrixAt(i, m);
    }
    sleepers.instanceMatrix.needsUpdate = true;
    g.add(sleepers);

    // two rails
    const railMat = new THREE.MeshStandardMaterial({ color: '#a6acb3', roughness: 0.35, metalness: 0.85 });
    for (const off of [-0.72, 0.72]) {
      const curve = new THREE.CatmullRomCurve3(this.vecs(off, RAIL_H), true, 'catmullrom', 0.02);
      const geo = new THREE.TubeGeometry(curve, 700, 0.065, 6, true);
      const rail = new THREE.Mesh(geo, railMat);
      rail.castShadow = true;
      g.add(rail);
    }

    // two signals along the line
    const poleMat = new THREE.MeshStandardMaterial({ color: '#55585c', roughness: 0.6, metalness: 0.3 });
    for (const [frac, green] of [[0.28, true], [0.68, false]] as const) {
      const s = frac * this.length;
      const p = this.posAt(s);
      const h = this.headingAt(s);
      const sig = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), poleMat);
      pole.position.y = 2.2;
      pole.castShadow = true;
      sig.add(pole);
      const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.3), poleMat);
      headBox.position.y = 4.4;
      sig.add(headBox);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 10, 8),
        new THREE.MeshStandardMaterial({
          color: green ? '#4ade80' : '#e2483f',
          emissive: new THREE.Color(green ? '#4ade80' : '#ff5f52'),
          emissiveIntensity: 1.6,
          roughness: 0.4,
        })
      );
      lamp.position.set(0, 4.55, 0.18);
      sig.add(lamp);
      // stand just outside the rails, facing along the track
      const nx = Math.cos(h), nz = -Math.sin(h);
      sig.position.set(p.x + nx * 3.2, 0, p.z + nz * 3.2);
      sig.rotation.y = h;
      g.add(sig);
    }

    return g;
  }
}

// ============================================================================
// Train model
// ============================================================================

export const GAP = 9.7; // metres between car centres (shared with the placement ghost)

export function buildTrainModel(seed = 1): { group: THREE.Group; cars: THREE.Group[] } {
  const r = makeRng(seed);
  const group = new THREE.Group();
  const cars: THREE.Group[] = [];
  const wagons = ['#2f6fb8', '#3f8f57', '#c9c9cf', '#d98b2b'];

  for (let i = 0; i < 5; i++) {
    const car = new THREE.Group();
    const loco = i === 0;
    const color = loco ? '#c43b31' : wagons[Math.floor(r() * wagons.length)];

    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.3, 9), bodyMat);
    body.castShadow = true;
    body.position.y = 2.0;
    car.add(body);

    // window band (wraps the car in one mesh, glows faintly at night)
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(2.66, 0.85, 8.4),
      new THREE.MeshStandardMaterial({
        color: '#101822', roughness: 0.15, metalness: 0.4,
        emissive: new THREE.Color('#ffe9c0'), emissiveIntensity: 0.45,
      })
    );
    band.position.y = 2.45;
    car.add(band);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 8.7), new THREE.MeshStandardMaterial({ color: '#e6e8ea', roughness: 0.7 }));
    roof.position.y = 3.25;
    car.add(roof);

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.5, 8.6), new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.8 }));
    skirt.position.y = 0.85;
    car.add(skirt);

    // bogies + wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#1f2124', roughness: 0.5, metalness: 0.5 });
    for (const bz of [-2.9, 2.9]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.3, 1.7), wheelMat);
      bogie.position.set(0, 0.55, bz);
      car.add(bogie);
      for (const oz of [-0.6, 0.6]) {
        for (const ox of [-1.0, 1.0]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 14), wheelMat);
          w.rotation.z = Math.PI / 2;
          w.position.set(ox, 0.42, bz + oz);
          car.add(w);
        }
      }
    }

    if (loco) {
      // sloped nose + windshield + headlights + pilot
      const nose = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.8), bodyMat);
      nose.position.set(0, 1.4, 5.0);
      nose.castShadow = true;
      car.add(nose);
      const windshield = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 1.0, 0.14),
        new THREE.MeshStandardMaterial({ color: '#0e161f', roughness: 0.1, metalness: 0.5 })
      );
      windshield.position.set(0, 2.5, 4.5);
      windshield.rotation.x = -0.3;
      car.add(windshield);
      const pilot = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.5), wheelMat);
      pilot.position.set(0, 0.6, 5.9);
      car.add(pilot);
      for (const s of [-1, 1]) {
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 10, 8),
          new THREE.MeshStandardMaterial({
            color: '#fff3cc', emissive: new THREE.Color('#fff3cc'), emissiveIntensity: 2.2, roughness: 0.3,
          })
        );
        light.position.set(s * 0.8, 1.5, 5.85);
        car.add(light);
      }
    }

    cars.push(car);
    group.add(car);
  }
  return { group, cars };
}

export class Train {
  group: THREE.Group;
  progress: number;
  speed: number;
  private cars: THREE.Group[];

  constructor(progress: number, seed = 1) {
    const m = buildTrainModel(seed);
    this.group = m.group;
    this.cars = m.cars;
    this.progress = progress;
    this.speed = 10 + (seed % 7);

    this.group.userData.editable = true;
    this.group.userData.kind = 'train';
    this.group.userData.record = {
      kind: 'train' as const,
      position: [0, 0, 0] as [number, number, number],
      rotationY: 0,
      progress,
    };
    this.group.userData.train = this;
  }

  update(dt: number, loop: RailLoop): void {
    this.progress = (this.progress + this.speed * dt) % loop.length;
    for (let i = 0; i < this.cars.length; i++) {
      const s = this.progress - i * GAP;
      const p = loop.posAt(s);
      const car = this.cars[i];
      car.position.set(p.x, 0, p.z);
      car.rotation.y = loop.headingAt(s);
    }
    // keep the record's position roughly at the locomotive (cosmetic)
    const rec = this.group.userData.record as { position: [number, number, number]; rotationY: number } | undefined;
    if (rec) {
      const p = loop.posAt(this.progress);
      rec.position[0] = p.x;
      rec.position[1] = 0;
      rec.position[2] = p.z;
      rec.rotationY = loop.headingAt(this.progress);
    }
  }
}
