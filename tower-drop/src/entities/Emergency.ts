import * as THREE from 'three';
import { registerFacade } from '../utils/materialRegistry';
import { makeRng } from '../utils/textures';
import { roadCenter, GRID } from '../types';
import type { PlaceableKind } from '../types';

// ============================================================================
// Emergency services: fire station facility, fire effect (flames + smoke),
// and a fire truck that drives the road grid to the scene, raises its
// ladder and sprays the fire out. All procedural, zero external assets.
// ============================================================================

// ---------------------------------------------------------------- fire station

function tag(g: THREE.Object3D, kind: PlaceableKind): void {
  g.userData.editable = true;
  g.userData.kind = kind;
  g.userData.record = { kind, position: [0, 0, 0] as [number, number, number], rotationY: 0 };
}

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
  ctx.fillStyle = fg;
  ctx.font = 'bold 60px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function createFireStation(): THREE.Group {
  const g = new THREE.Group();
  const r = makeRng(501);

  const brick = new THREE.MeshStandardMaterial({ color: '#a8453a', roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.8 });
  const doorMat = new THREE.MeshStandardMaterial({ color: '#d8d4ca', roughness: 0.5, metalness: 0.3 });
  const doorFrame = new THREE.MeshStandardMaterial({ color: '#7e2a22', roughness: 0.85 });
  const darkGlass = new THREE.MeshStandardMaterial({
    color: '#1c2530', roughness: 0.15, metalness: 0.4,
    emissive: new THREE.Color('#ffe3a8'), emissiveIntensity: 0,
  });
  registerFacade(darkGlass);
  const roofMat = new THREE.MeshStandardMaterial({ color: '#6e6a63', roughness: 0.95 });
  const apronMat = new THREE.MeshStandardMaterial({ color: '#b9b4ab', roughness: 1 });

  // concrete apron in front of the bays
  const apron = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 9), apronMat);
  apron.position.set(0, 0.05, 8);
  apron.receiveShadow = true;
  g.add(apron);

  // main engine bay block
  g.add(box(14, 5, 8, brick, 0, 2.5, 0));
  g.add(box(14.5, 0.55, 8.5, trim, 0, 5.1, 0));       // cornice band
  const roof = box(14, 0.3, 8, roofMat, 0, 5.5, 0);
  roof.castShadow = false;
  g.add(roof);

  // two garage bays on the front (+z) face
  for (const dx of [-3.3, 3.3]) {
    g.add(box(5.4, 4.3, 0.25, doorFrame, dx, 2.15, 4.0));
    g.add(box(4.8, 3.8, 0.3, doorMat, dx, 1.9, 4.08));
    for (let i = 0; i < 4; i++) {
      g.add(box(4.6, 0.1, 0.12, doorFrame, dx, 0.7 + i * 0.85, 4.24));
    }
  }

  // office window + side entrance
  g.add(box(2.6, 1.5, 0.22, darkGlass, 0, 3.6, 4.06));
  g.add(box(1.2, 2.3, 0.24, darkGlass, 6.1, 1.2, 4.05));
  g.add(box(1.5, 2.6, 0.2, trim, 6.1, 1.3, 3.98));

  // hose tower (drying tower) at the west end
  g.add(box(2.4, 10.5, 2.4, brick, -5.6, 5.25, -2.2));
  g.add(box(2.8, 0.5, 2.8, trim, -5.6, 10.6, -2.2));
  g.add(box(0.4, 2.2, 1.6, darkGlass, -5.6, 8.4, -1.0));

  // rooftop AC unit + antenna
  g.add(box(1.8, 0.9, 1.6, roofMat, 3.5, 6.0, -1.6));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3, 5), roofMat);
  mast.position.set(-1.5, 7.1, 2.4);
  g.add(mast);

  // red sign board
  const signMat = new THREE.MeshStandardMaterial({
    map: signTexture('FIRE STATION', '#c8281e', '#ffffff'),
    emissive: new THREE.Color('#ff5040'), emissiveIntensity: 0.25, roughness: 0.6,
  });
  g.add(box(7.2, 1.1, 0.3, signMat, 0, 4.6, 4.28));

  // hoses hung on the side wall + a hydrant by the apron
  const hoseMat = new THREE.MeshStandardMaterial({ color: '#d9c23f', roughness: 0.9 });
  g.add(box(0.3, 1.6, 3.4, hoseMat, -7.15, 2.6, 0.5));
  const hydrant = new THREE.Group();
  const hydMat = new THREE.MeshStandardMaterial({ color: '#d0342c', roughness: 0.55, metalness: 0.2 });
  const hydBody = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.8, 8), hydMat);
  hydBody.position.y = 0.4;
  const hydCap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), hydMat);
  hydCap.position.y = 0.85;
  hydrant.add(hydBody, hydCap);
  hydrant.position.set(7.6, 0, 9.5);
  hydrant.traverse((o) => { o.castShadow = true; });
  g.add(hydrant);

  // antenna beacon that glows at night
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#7a1a14', emissive: '#ff4030', emissiveIntensity: 1.6, roughness: 0.4 })
  );
  beacon.position.set(-1.5, 8.7, 2.4);
  g.add(beacon);

  void r;
  tag(g, 'firestation');
  return g;
}

// ---------------------------------------------------------------- fire effect

interface Ember { age: number; life: number; bx: number; bz: number; vy: number; vx: number; vz: number; }

/**
 * Flames + dark smoke + flickering light on a building roof.
 * `intensity` drops toward 0 while the truck sprays it.
 */
export class FireEffect {
  group = new THREE.Group();
  intensity = 1;

  private flames: THREE.Points;
  private smoke: THREE.Points;
  private light: THREE.PointLight;
  private flameData: Ember[] = [];
  private smokeData: Ember[] = [];
  private flameGeo: THREE.BufferGeometry;
  private smokeGeo: THREE.BufferGeometry;
  private flameMat: THREE.PointsMaterial;
  private smokeMat: THREE.PointsMaterial;
  private t = 0;
  private radius: number;

  constructor(x: number, y: number, z: number, radius = 3.2) {
    this.radius = radius;
    const r = makeRng(Math.floor(Math.abs(x * 13 + z * 7)) + 3);

    // ---- flames: additive orange→red points rising off the roof ----
    const FN = 70;
    this.flameGeo = new THREE.BufferGeometry();
    const fPos = new Float32Array(FN * 3);
    const fCol = new Float32Array(FN * 3);
    for (let i = 0; i < FN; i++) {
      const a = r() * Math.PI * 2;
      const rad = r() * radius;
      this.flameData.push({
        age: r(), life: 0.5 + r() * 0.7,
        bx: Math.cos(a) * rad, bz: Math.sin(a) * rad,
        vy: 2.6 + r() * 2.4, vx: (r() - 0.5) * 1.2, vz: (r() - 0.5) * 1.2,
      });
      fCol[i * 3] = 1; fCol[i * 3 + 1] = 0.7; fCol[i * 3 + 2] = 0.2;
    }
    this.flameGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    this.flameGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
    this.flameMat = new THREE.PointsMaterial({
      size: 1.5, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flames = new THREE.Points(this.flameGeo, this.flameMat);
    this.flames.frustumCulled = false;
    this.flames.raycast = () => void 0;

    // ---- smoke: dark gray points drifting up and downwind ----
    const SN = 60;
    this.smokeGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(SN * 3);
    const sCol = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) {
      const a = r() * Math.PI * 2;
      const rad = r() * radius * 0.8;
      this.smokeData.push({
        age: r() * 2, life: 2.6 + r() * 2.4,
        bx: Math.cos(a) * rad, bz: Math.sin(a) * rad,
        vy: 2.2 + r() * 1.8, vx: 0.9 + r() * 0.7, vz: (r() - 0.5) * 0.8,
      });
      const g = 0.16 + r() * 0.1;
      sCol[i * 3] = g; sCol[i * 3 + 1] = g; sCol[i * 3 + 2] = g;
    }
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    this.smokeGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    this.smokeMat = new THREE.PointsMaterial({
      size: 3.4, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.smoke = new THREE.Points(this.smokeGeo, this.smokeMat);
    this.smoke.frustumCulled = false;
    this.smoke.raycast = () => void 0;

    this.light = new THREE.PointLight('#ff7a2a', 0, 46, 1.8);

    this.group.position.set(x, y, z);
    this.group.add(this.flames, this.smoke, this.light);
    this.update(0.016);
  }

  update(dt: number): void {
    this.t += dt;
    const p = this.flameGeo.getAttribute('position') as THREE.BufferAttribute;
    const c = this.flameGeo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.flameData.length; i++) {
      const e = this.flameData[i];
      e.age += dt;
      if (e.age > e.life) e.age -= e.life;
      const u = e.age / e.life;
      const wob = Math.sin(this.t * 7 + i * 1.7) * 0.25 * u;
      p.setXYZ(i, e.bx + e.vx * e.age + wob, u * u * e.vy * e.life * 0.55, e.bz + e.vz * e.age);
      // white-yellow core → orange → deep red as it ages
      const heat = 1 - u;
      c.setXYZ(i, 1, 0.35 + heat * 0.55, 0.06 + heat * heat * 0.55);
    }
    p.needsUpdate = true;
    c.needsUpdate = true;

    const sp = this.smokeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.smokeData.length; i++) {
      const e = this.smokeData[i];
      e.age += dt;
      if (e.age > e.life) e.age -= e.life;
      const u = e.age / e.life;
      sp.setXYZ(i, e.bx + e.vx * e.age, u * e.vy * e.life * 0.8, e.bz + e.vz * e.age + Math.sin(this.t * 0.8 + i) * u * 1.4);
    }
    sp.needsUpdate = true;

    // fire light: flicker, scaled by remaining intensity
    const flick = 0.75 + Math.sin(this.t * 11) * 0.12 + Math.sin(this.t * 23 + 1.3) * 0.08;
    this.light.intensity = 4.2 * flick * this.intensity;
    this.flameMat.opacity = 0.95 * this.intensity;
    this.smokeMat.opacity = 0.5 * (0.35 + 0.65 * this.intensity);
    const s = 0.6 + 0.4 * this.intensity;
    this.flameMat.size = 1.5 * s;
  }

  /** Douse progress; returns true once the fire is out */
  douse(rate: number, dt: number): boolean {
    this.intensity = Math.max(0, this.intensity - rate * dt);
    if (this.intensity <= 0) {
      this.group.visible = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.flameGeo.dispose();
    this.smokeGeo.dispose();
    this.flameMat.dispose();
    this.smokeMat.dispose();
    this.light.dispose();
  }
}

// ---------------------------------------------------------------- fire truck

export type TruckState = 'driving' | 'aiming' | 'spraying' | 'returning' | 'done';

interface WP { x: number; z: number; }

/** Nearest road-center coordinate for a value along one axis */
function nearestRoad(v: number): number {
  let bk = 0, bd = 1e9;
  for (let k = 0; k <= GRID; k++) {
    const c = roadCenter(k);
    const d = Math.abs(c - v);
    if (d < bd) { bd = d; bk = k; }
  }
  return roadCenter(bk);
}

/**
 * Manhattan path along the road grid from the station's snap point to a
 * road-side stop next to the fire. Returns lane-relative waypoints.
 */
export function buildEmergencyPath(sx: number, sz: number, fx: number, fz: number): { path: WP[]; stop: WP } {
  const vx = nearestRoad(sx);        // vertical road (x = const) nearest station
  const hzRoad = nearestRoad(fz);    // horizontal road (z = const) nearest fire (fallback)
  const vFire = nearestRoad(fx);     // vertical road nearest fire
  const dx = Math.abs(fx - vFire);
  const dz = Math.abs(fz - hzRoad);

  let stop: WP;
  let path: WP[];
  if (dx <= dz) {
    // stop on the vertical road beside the fire; approach through the nearest
    // horizontal road so every segment stays on pavement
    stop = { x: vFire, z: fz };
    path = [{ x: vx, z: sz }, { x: vx, z: hzRoad }, { x: vFire, z: hzRoad }, stop];
  } else {
    stop = { x: fx, z: hzRoad };
    path = [{ x: vx, z: sz }, { x: vx, z: hzRoad }, stop];
  }
  // drop degenerate points
  path = path.filter((p, i) => i === 0 || Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) > 3);
  if (path.length && Math.hypot(path[path.length - 1].x - sx, path[path.length - 1].z - sz) < 3) path = [];
  return { path, stop };
}

export class FireTruck {
  group = new THREE.Group();
  state: TruckState = 'driving';

  private path: WP[];
  private stop: WP;
  private home: WP;
  private wi = 0;
  private segAxis: 'x' | 'z' = 'x';
  private segDir = 1;
  private segFrom: WP = { x: 0, z: 0 };
  private speed = 9.5;
  private yaw: number;
  private targetYaw: number;
  private ladder: THREE.Group;
  private ladderLift = 0;          // 0 flat → 1 raised
  private spray: THREE.Points;
  private sprayGeo: THREE.BufferGeometry;
  private sprayMat: THREE.PointsMaterial;
  private sprayT = 0;
  private flashT = 0;
  private redMat: THREE.MeshStandardMaterial;
  private blueMat: THREE.MeshStandardMaterial;
  private aimTimer = 0;
  private fire: { x: number; y: number; z: number };
  private fireWorld = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(sx: number, sz: number, fire: { x: number; y: number; z: number }) {
    this.fire = fire;
    const { path, stop } = buildEmergencyPath(sx, sz, fire.x, fire.z);
    this.path = path;
    this.stop = stop;
    this.home = { x: sx, z: sz };
    this.fireWorld.set(fire.x, fire.y, fire.z);

    // ---------------- model (long axis +x, like the cars) ----------------
    const red = new THREE.MeshStandardMaterial({ color: '#cf2b21', roughness: 0.45, metalness: 0.15 });
    const white = new THREE.MeshStandardMaterial({ color: '#f0eee9', roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#141a22', roughness: 0.2, metalness: 0.5 });
    const metal = new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.4, metalness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.95 });
    this.redMat = new THREE.MeshStandardMaterial({ color: '#5a0f0c', emissive: '#ff2a20', emissiveIntensity: 2.4, roughness: 0.4 });
    this.blueMat = new THREE.MeshStandardMaterial({ color: '#0c1450', emissive: '#2a5aff', emissiveIntensity: 0, roughness: 0.4 });

    // chassis + cab + locker body
    this.group.add(box(7.4, 0.5, 2.3, red, 0, 0.75, 0));
    this.group.add(box(2.5, 1.5, 2.25, red, 2.35, 1.65, 0));       // cab
    this.group.add(box(0.14, 0.85, 1.9, dark, 3.58, 1.95, 0));      // windshield
    this.group.add(box(0.1, 0.5, 1.7, dark, 3.6, 1.4, 0));
    this.group.add(box(4.6, 1.7, 2.3, red, -1.1, 1.6, 0));          // equipment body
    this.group.add(box(4.64, 0.34, 2.34, white, -1.1, 1.25, 0));    // stripe
    this.group.add(box(2.54, 0.34, 2.29, white, 2.35, 1.3, 0));
    // roller shutters on the body sides
    this.group.add(box(3.6, 1.1, 0.1, metal, -1.1, 1.85, 1.19));
    this.group.add(box(3.6, 1.1, 0.1, metal, -1.1, 1.85, -1.19));
    // headlights + rear light bar
    const head = new THREE.MeshStandardMaterial({ color: '#ffe9c0', emissive: '#ffe9c0', emissiveIntensity: 1.6, roughness: 0.3 });
    this.group.add(box(0.12, 0.3, 0.5, head, 3.64, 1.0, 0.7));
    this.group.add(box(0.12, 0.3, 0.5, head, 3.64, 1.0, -0.7));
    this.group.add(box(0.1, 0.3, 2.0, new THREE.MeshStandardMaterial({ color: '#6a1010', emissive: '#ff3020', emissiveIntensity: 1.2 }), -3.66, 1.1, 0));

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.36, 12);
    for (const [wx, wz] of [[2.5, 1.12], [2.5, -1.12], [-1.6, 1.12], [-1.6, -1.12], [-2.7, 1.12], [-2.7, -1.12]] as const) {
      const w = new THREE.Mesh(wheelGeo, rubber);
      w.rotation.x = Math.PI / 2;   // cylinder axis y → z (axle across the truck)
      w.position.set(wx, 0.52, wz);
      w.castShadow = true;
      this.group.add(w);
    }

    // flashing light bar on the cab roof
    this.group.add(box(0.6, 0.2, 0.5, this.redMat, 2.1, 2.5, -0.28));
    this.group.add(box(0.6, 0.2, 0.5, this.blueMat, 2.1, 2.5, 0.28));

    // ladder assembly on a rotating pivot above the body
    this.ladder = new THREE.Group();
    const railL = box(5.8, 0.12, 0.14, metal, 2.6, 0, 0.34);
    const railR = box(5.8, 0.12, 0.14, metal, 2.6, 0, -0.34);
    railL.castShadow = railR.castShadow = true;
    this.ladder.add(railL, railR);
    for (let i = 0; i < 7; i++) {
      this.ladder.add(box(0.1, 0.07, 0.62, metal, 0.4 + i * 0.78, 0, 0));
    }
    // nozzle basket at the tip
    this.ladder.add(box(0.5, 0.3, 0.5, red, 5.6, 0.14, 0));
    this.ladder.position.set(-2.2, 2.75, 0);
    this.group.add(this.ladder);

    // spray particles (world-space computed each frame)
    const N = 40;
    this.sprayGeo = new THREE.BufferGeometry();
    this.sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.sprayMat = new THREE.PointsMaterial({
      color: '#dff2ff', size: 0.55, sizeAttenuation: true,
      transparent: true, opacity: 0.85, depthWrite: false,
    });
    this.spray = new THREE.Points(this.sprayGeo, this.sprayMat);
    this.spray.frustumCulled = false;
    this.spray.visible = false;
    this.spray.raycast = () => void 0;
    this.group.add(this.spray);

    // spawn: face the first waypoint (or the fire if the path is clear)
    const first = this.path[0] || this.stop;
    this.yaw = Math.atan2(first.z - sz, first.x - sx);
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    this.targetYaw = this.yaw;
    this.group.position.set(sx, 0, sz);
    this.group.rotation.y = this.yaw;
    this.segFrom = { x: sx, z: sz };
    this.calcSeg();
    if (!this.path.length) this.state = 'aiming';
  }

  get spraying(): boolean { return this.state === 'spraying'; }

  update(dt: number): void {
    this.flashT += dt;
    const phase = (this.flashT * 4) % 2;
    this.redMat.emissiveIntensity = phase < 1 ? 2.6 : 0.15;
    this.blueMat.emissiveIntensity = phase < 1 ? 0.15 : 2.6;

    const pos = this.group.position;

    if (this.state === 'driving' || this.state === 'returning') {
      const wp = this.path[this.wi];
      if (!wp) { this.state = 'done'; return; }
      const laneLerp = Math.min(1, dt * 4);
      // travel strictly along the segment's axis (the target sits on the road
      // center-line while we ride the lane — so arrival is axis-only too)
      if (this.segAxis === 'x') {
        const dx = wp.x - pos.x;
        if (Math.abs(dx) < 1.5) { this.advance(pos); return; }
        pos.x += Math.sign(dx) * Math.min(this.speed * dt, Math.abs(dx));
        // ride the right-hand lane — only when this segment follows a road
        // (the station hop may cross grass/sidewalk)
        const road = nearestRoad(wp.z);
        if (Math.abs(road - wp.z) < 0.8) {
          pos.z += ((road + this.segDir * 3) - pos.z) * laneLerp;
        }
        this.targetYaw = this.segDir > 0 ? 0 : Math.PI;
      } else {
        const dz = wp.z - pos.z;
        if (Math.abs(dz) < 1.5) { this.advance(pos); return; }
        pos.z += Math.sign(dz) * Math.min(this.speed * dt, Math.abs(dz));
        const road = nearestRoad(wp.x);
        if (Math.abs(road - wp.x) < 0.8) {
          pos.x += ((road - this.segDir * 3) - pos.x) * laneLerp;
        }
        this.targetYaw = this.segDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    } else if (this.state === 'aiming') {
      this.aimTimer += dt;
      const dx = this.fire.x - pos.x;
      const dz = this.fire.z - pos.z;
      this.targetYaw = Math.atan2(dz, dx);
      this.ladderLift = Math.min(1, this.ladderLift + dt * 1.4);
      if (this.aimTimer > 1.6 && Math.abs(this.angleDelta(this.targetYaw, this.yaw)) < 0.2) {
        this.state = 'spraying';
        this.spray.visible = true;
      }
    } else if (this.state === 'spraying') {
      this.ladderLift = Math.min(1, this.ladderLift + dt * 0.8);
      this.sprayT += dt;
      this.updateSpray();
    } else if (this.state === 'done') {
      // handled by CitySystem (disposal)
    }

    // smooth heading
    this.yaw += this.angleDelta(this.targetYaw, this.yaw) * Math.min(1, dt * 3.5);
    this.group.rotation.y = this.yaw;
    // ladder raise
    this.ladder.rotation.z = this.ladderLift * 0.42;
  }

  /** Fire fully out → head home along the road grid */
  goHome(): void {
    const pos = this.group.position;
    const { path } = buildEmergencyPath(pos.x, pos.z, this.home.x, this.home.z);
    this.path = path;
    this.wi = 0;
    this.state = path.length ? 'returning' : 'done';
    this.spray.visible = false;
    this.ladderLift = 0;
    this.segFrom = { x: pos.x, z: pos.z };
    this.calcSeg();
  }

  /** Reach the waypoint → start the next segment with fresh axis/direction */
  private advance(pos: THREE.Vector3): void {
    this.wi++;
    this.segFrom = { x: pos.x, z: pos.z };
    if (this.wi >= this.path.length) {
      if (this.state === 'driving') { this.state = 'aiming'; this.aimTimer = 0; }
      else this.state = 'done';
      return;
    }
    this.calcSeg();
  }

  /** Segment axis + travel direction from the path geometry (never flips) */
  private calcSeg(): void {
    const wp = this.path[this.wi];
    if (!wp) return;
    const dx = wp.x - this.segFrom.x;
    const dz = wp.z - this.segFrom.z;
    this.segAxis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
    this.segDir = (this.segAxis === 'x' ? Math.sign(dx) : Math.sign(dz)) || 1;
  }

  private updateSpray(): void {
    // nozzle world position (ladder tip basket)
    this.tmp.set(5.4, 0.2, 0);
    this.ladder.localToWorld(this.tmp);
    const nozzle = this.tmp.clone();
    const attr = this.sprayGeo.getAttribute('position') as THREE.BufferAttribute;
    const n = attr.count;
    for (let i = 0; i < n; i++) {
      const u = ((i / n) + (this.sprayT * 1.7) % 1) % 1;
      const x = nozzle.x + (this.fire.x - nozzle.x) * u;
      const z = nozzle.z + (this.fire.z - nozzle.z) * u;
      const y = nozzle.y + (this.fire.y - nozzle.y) * u + Math.sin(Math.PI * u) * 3.2;
      attr.setXYZ(i, x, y, z);
    }
    attr.needsUpdate = true;
    this.sprayGeo.computeBoundingSphere();
  }

  private angleDelta(target: number, from: number): number {
    let d = target - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as unknown as { material?: THREE.Material }).material;
      if (mat) mat.dispose();
    });
    this.sprayGeo.dispose();
    this.sprayMat.dispose();
  }
}
