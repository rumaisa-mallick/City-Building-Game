import * as THREE from 'three';
import { gravelTexture, makeRng } from '../utils/textures';
import { registerLamp } from '../utils/materialRegistry';

/**
 * River district east of the road grid: a stone-walled canal cuts east–west
 * across the rail loop's straight, so trains roll over a girder bridge.
 * North bank gets a promenade (path, lamps, benches, trees, reeds, a pier
 * with a moored boat); two boats cruise the water. Fully procedural.
 */

// --- layout (world coords) ---
const X0 = 142;      // west water edge (city side)
const X1 = 340;      // east water edge (tucked into hills)
const ZS = -124;     // south bank
const ZN = -88;      // north bank
const ZC = (ZS + ZN) / 2;
const RAIL_X = 156;  // rail loop east straight crosses here
const GAP_W = 152;   // gap in the canal walls for the railway
const GAP_E = 160;
const PROM_W = 166;  // promenade span (east of the bridge)
const PROM_E = 300;
const WATER_Y = 0.06;
const WALL_H = 0.95;

/** Scenery (far trees / hills) must not spawn in the water district */
export function riverBlocksPoint(x: number, z: number): boolean {
  return x > 140 && x < 344 && z > -127 && z < -72;
}

function waterNormalTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#8080ff';
  x.fillRect(0, 0, 128, 128);
  const r = makeRng(4242);
  for (let i = 0; i < 90; i++) {
    const px = r() * 128;
    const py = r() * 128;
    const rad = 7 + r() * 18;
    const dr = Math.round(128 + (r() - 0.5) * 110);
    const dg = Math.round(128 + (r() - 0.5) * 110);
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgb(${dr},${dg},255)`);
    g.addColorStop(1, 'rgba(128,128,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, rad, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

interface Boat {
  g: THREE.Group;
  x: number;
  z: number;
  dir: number;
  speed: number;
  phase: number;
  rot: number;
  moored: boolean;
}

export class River {
  group = new THREE.Group();

  private waterMat: THREE.MeshStandardMaterial;
  private waterNrm: THREE.CanvasTexture;
  private boats: Boat[] = [];
  private elapsed = 0;
  private snowMats: Array<{ m: THREE.MeshStandardMaterial; snow: string; orig: string }> = [];

  constructor() {
    const r = makeRng(777);

    // ---------- materials ----------
    const stone = new THREE.MeshStandardMaterial({ color: '#9a938a', roughness: 0.95 });
    const stoneCap = new THREE.MeshStandardMaterial({ color: '#b3aa9d', roughness: 0.9 });
    const gravel = gravelTexture();
    gravel.repeat.set(34, 1.4);
    const pathMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 });
    const hillMat = new THREE.MeshStandardMaterial({ color: '#3f6b35', roughness: 1 });
    const steel = new THREE.MeshStandardMaterial({ color: '#878e96', roughness: 0.5, metalness: 0.55 });
    const steelDark = new THREE.MeshStandardMaterial({ color: '#565c63', roughness: 0.6, metalness: 0.4 });
    const concrete = new THREE.MeshStandardMaterial({ color: '#a8a49c', roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9 });
    const metalDark = new THREE.MeshStandardMaterial({ color: '#2e3338', roughness: 0.6, metalness: 0.3 });
    const reedMat = new THREE.MeshStandardMaterial({ color: '#5f8a4a', roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#35602f', roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3828', roughness: 1 });

    // snow-reactive materials
    const reg = (m: THREE.MeshStandardMaterial, snow: string): void => {
      this.snowMats.push({ m, snow, orig: `#${m.color.getHexString()}` });
    };
    reg(stone, '#dde5eb');
    reg(stoneCap, '#eef3f7');
    reg(pathMat, '#f0f4f7');
    reg(hillMat, '#e2e9f0');
    reg(concrete, '#e4eaef');

    // ---------- water ----------
    this.waterNrm = waterNormalTex();
    this.waterNrm.repeat.set(14, 3);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: '#2f6f8f',
      roughness: 0.08,
      metalness: 0.2,
      normalMap: this.waterNrm,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const waterGeo = new THREE.PlaneGeometry(X1 - X0, ZN - ZS);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, this.waterMat);
    water.position.set((X0 + X1) / 2, WATER_Y, ZC);
    water.receiveShadow = true;
    water.raycast = () => void 0;
    this.group.add(water);

    // ---------- canal walls (gap at the railway) ----------
    const wallSeg = (x0: number, x1: number, z: number): void => {
      const len = x1 - x0;
      const cx = (x0 + x1) / 2;
      const w = box(len, WALL_H - 0.1, 1.0, stone, cx, (WALL_H - 0.1) / 2, z);
      w.receiveShadow = true;
      this.group.add(w);
      this.group.add(box(len, 0.12, 1.3, stoneCap, cx, WALL_H - 0.04, z));
    };
    wallSeg(X0, GAP_W, ZS - 0.5);
    wallSeg(GAP_E, X1, ZS - 0.5);
    wallSeg(X0, GAP_W, ZN + 0.5);
    wallSeg(GAP_E, X1, ZN + 0.5);
    // west cap closes the canal
    const cap = box(1.0, WALL_H - 0.1, ZN - ZS + 2, stone, X0 - 0.5, (WALL_H - 0.1) / 2, ZC);
    cap.receiveShadow = true;
    this.group.add(cap);
    this.group.add(box(1.3, 0.12, ZN - ZS + 2, stoneCap, X0 - 0.5, WALL_H - 0.04, ZC));

    // ---------- promenade railing on the north wall ----------
    const railZ = ZN + 0.5;
    const railLen = PROM_E - PROM_W + 4;
    this.group.add(box(railLen, 0.07, 0.07, metalDark, (PROM_W + PROM_E) / 2, 1.5, railZ));
    for (let x = PROM_W - 2; x <= PROM_E + 2; x += 2.6) {
      this.group.add(box(0.07, 0.56, 0.07, metalDark, x, 1.24, railZ));
    }

    // ---------- rail bridge: through-girder over the canal ----------
    const span = (ZN - ZS) + 3.6;
    const gz = ZC;
    // deck
    const deck = box(6.4, 0.3, span, steelDark, RAIL_X, 0.04, gz);
    deck.receiveShadow = true;
    this.group.add(deck);
    // side girders + ribs + top caps
    for (const dx of [-3.45, 3.45]) {
      const g = box(0.5, 1.55, span, steel, RAIL_X + dx, 0.78, gz);
      this.group.add(g);
      this.group.add(box(0.62, 0.12, span, steelDark, RAIL_X + dx, 1.5, gz));
      for (let i = 0; i < 9; i++) {
        const rz = ZS - 1 + i * ((ZN - ZS + 2) / 8);
        this.group.add(box(0.58, 1.6, 0.26, steelDark, RAIL_X + dx, 0.78, rz));
      }
    }
    // abutment portals on land at the wall gaps
    for (const px of [RAIL_X - 5.25, RAIL_X + 5.25]) {
      this.group.add(box(2.8, 1.35, 1.3, concrete, px, 0.675, ZS - 0.5));
      this.group.add(box(2.8, 1.35, 1.3, concrete, px, 0.675, ZN + 0.5));
    }

    // ---------- promenade: path, lamps, benches, trees ----------
    const pathGeo = new THREE.PlaneGeometry(PROM_E - PROM_W, 4.6);
    pathGeo.rotateX(-Math.PI / 2);
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.position.set((PROM_W + PROM_E) / 2, 0.02, ZN - 7.5);
    path.receiveShadow = true;
    this.group.add(path);

    const lampGlow = new THREE.MeshStandardMaterial({
      color: '#3a3f45', emissive: '#ffe3a8', emissiveIntensity: 0.4, roughness: 0.4,
    });
    registerLamp(lampGlow);
    for (let x = PROM_W + 6; x <= PROM_E - 6; x += 25) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 5, 6), metalDark);
      pole.position.set(x, 2.5, ZN - 4.6);
      pole.castShadow = true;
      this.group.add(pole);
      this.group.add(box(0.55, 0.28, 0.55, lampGlow, x, 5.05, ZN - 4.6));
    }

    const benchAt = (x: number): void => {
      const b = new THREE.Group();
      b.add(box(1.9, 0.12, 0.55, wood, 0, 0.48, 0));
      b.add(box(1.9, 0.5, 0.1, wood, 0, 0.74, 0.24));
      b.add(box(0.12, 0.48, 0.55, metalDark, -0.75, 0.24, 0));
      b.add(box(0.12, 0.48, 0.55, metalDark, 0.75, 0.24, 0));
      b.position.set(x, 0, ZN - 10.4);
      b.children.forEach((c) => { c.castShadow = true; });
      this.group.add(b);
    };
    for (const x of [180, 205, 258, 288]) benchAt(x);

    const treeAt = (x: number, z: number): void => {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 4, 6), trunkMat);
      trunk.position.y = 2;
      trunk.castShadow = true;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(2.4, 8, 7), leafMat);
      crown.position.y = 7.5;
      crown.castShadow = true;
      t.add(trunk, crown);
      t.position.set(x, 0, z);
      this.group.add(t);
    };
    for (const x of [172, 196, 222, 268, 294]) treeAt(x, ZN - 13.5 - r() * 3);
    for (const x of [178, 245, 290]) treeAt(x + r() * 6, ZS + 8 + r() * 6); // south bank

    // reeds at the water's edge
    const reedClump = (x: number, z: number): void => {
      const c = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const h = 0.9 + r() * 0.6;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), reedMat);
        b.position.set((r() - 0.5) * 0.7, h / 2, (r() - 0.5) * 0.7);
        b.rotation.z = (r() - 0.5) * 0.35;
        b.rotation.x = (r() - 0.5) * 0.35;
        c.add(b);
      }
      c.position.set(x, 0, z);
      this.group.add(c);
    };
    for (let x = PROM_W + 3; x <= PROM_E; x += 17) reedClump(x + r() * 5, ZN - 1.6);
    for (let x = X0 + 8; x <= X1 - 30; x += 21) reedClump(x + r() * 6, ZS + 1.8);

    // ---------- pier + moored boat ----------
    const pierZ = -92.6;
    const pierDeck = box(2.6, 0.16, 9, wood, 230, 0.9, pierZ);
    pierDeck.receiveShadow = true;
    this.group.add(pierDeck);
    for (const [px, pz] of [[229, -90], [231, -90], [229, -95.2], [231, -95.2]] as const) {
      this.group.add(box(0.2, 0.9, 0.2, wood, px, 0.45, pz));
    }
    this.group.add(box(0.18, 0.6, 0.18, metalDark, 229.2, 1.25, -96.6));
    this.group.add(box(0.18, 0.6, 0.18, metalDark, 230.8, 1.25, -96.6));

    // ---------- boats ----------
    const makeBoat = (hull: string): THREE.Group => {
      const g = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({ color: hull, roughness: 0.55 });
      const white = new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.6 });
      const glass = new THREE.MeshStandardMaterial({ color: '#1c2530', roughness: 0.2, metalness: 0.4 });
      const body = box(5.2, 0.72, 2.0, hullMat, 0, 0.3, 0);
      body.receiveShadow = true;
      g.add(body);
      g.add(box(4.6, 0.14, 2.06, white, 0, 0.62, 0));           // gunwale stripe
      g.add(box(1.9, 0.75, 1.6, white, -0.6, 1.0, 0));          // cabin
      g.add(box(0.14, 0.5, 1.4, glass, 0.4, 1.05, 0));          // windshield
      g.add(box(0.9, 0.18, 0.9, hullMat, -1.9, 0.75, 0));       // foredeck hatch
      return g;
    };

    const cruise = (z: number, dir: number, speed: number, x: number, hull: string): void => {
      const g = makeBoat(hull);
      g.position.set(x, WATER_Y, z);
      g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(g);
      this.boats.push({
        g, x, z, dir, speed, phase: r() * 6.28,
        rot: dir > 0 ? Math.PI / 2 : -Math.PI / 2, moored: false,
      });
    };
    cruise(-110, 1, 2.4, 190, '#c0392b');
    cruise(-97, -1, 1.9, 285, '#2874a6');

    const moored = makeBoat('#e08a2c');
    moored.position.set(233.8, WATER_Y, -93.4);
    moored.rotation.y = 0.15;
    this.group.add(moored);
    this.boats.push({
      g: moored, x: 233.8, z: -93.4, dir: 1, speed: 0, phase: r() * 6.28, rot: 0.15, moored: true,
    });

    // ---------- hills tucking the east end into the scenery ----------
    const hillAt = (x: number, z: number, rad: number, sy: number): void => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(rad, 26, 16), hillMat);
      h.scale.y = sy;
      h.position.set(x, 0, z);
      this.group.add(h);
    };
    hillAt(358, -106, 44, 0.33);
    hillAt(350, -152, 32, 0.3);
    hillAt(350, -56, 34, 0.3);
  }

  update(dt: number): void {
    this.elapsed += dt;
    const t = this.elapsed;
    // ripple drift
    this.waterNrm.offset.x = (t * 0.012) % 1;
    this.waterNrm.offset.y = (t * 0.005) % 1;

    for (const b of this.boats) {
      const bob = Math.sin(t * 1.35 + b.phase) * 0.05;
      b.g.position.y = WATER_Y + bob;
      b.g.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.035;
      if (b.moored) {
        b.g.rotation.y = b.rot + Math.sin(t * 0.5 + b.phase) * 0.06;
        continue;
      }
      b.x += b.dir * b.speed * dt;
      if (b.x > 318) b.dir = -1;
      if (b.x < 168) b.dir = 1;
      b.g.position.x = b.x;
      const target = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      let d = target - b.rot;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      b.rot += d * Math.min(1, dt * 1.6);
      b.g.rotation.y = b.rot;
    }
  }

  setSnow(on: boolean): void {
    for (const s of this.snowMats) s.m.color.set(on ? s.snow : s.orig);
  }
}
