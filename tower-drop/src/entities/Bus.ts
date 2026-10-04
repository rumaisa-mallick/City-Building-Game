import * as THREE from 'three';
import { GRID, roadCenter } from '../types';
import { nextSignalStop, type TrafficSystem } from '../systems/TrafficSystem';

/**
 * City bus: drives a rectangular loop along the inner ring road (right-hand
 * lanes like the cars), brakes for red lights and pauses at bus stops
 * that sit near its route.
 */

function buildBusModel(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#eceef2', roughness: 0.4, metalness: 0.25 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.7 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: '#2a6fd8', roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#182530', roughness: 0.1, metalness: 0.75 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(10.4, 2.6, 2.4), bodyMat);
  body.position.y = 1.85;
  body.castShadow = true;
  g.add(body);

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(10.42, 0.7, 2.44), skirtMat);
  skirt.position.y = 0.65;
  g.add(skirt);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(10.44, 0.3, 2.46), stripeMat);
  stripe.position.y = 1.3;
  g.add(stripe);

  // window band + windshield
  const band = new THREE.Mesh(new THREE.BoxGeometry(9.7, 1.0, 2.46), glassMat);
  band.position.set(-0.2, 2.35, 0);
  g.add(band);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 2.1), glassMat);
  shield.position.set(5.22, 2.3, 0);
  g.add(shield);

  // roof AC
  const ac = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.7), skirtMat);
  ac.position.set(-1.5, 3.3, 0);
  ac.castShadow = true;
  g.add(ac);

  // doors
  for (const dx of [2.7, -1.6]) {
    for (const sz of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.08), glassMat);
      door.position.set(dx, 1.5, sz * 1.22);
      g.add(door);
    }
  }

  // destination sign
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.42, 1.7),
    new THREE.MeshStandardMaterial({ color: '#2a2410', emissive: '#ffd977', emissiveIntensity: 1.2 })
  );
  sign.position.set(5.3, 2.95, 0);
  g.add(sign);

  // lights
  const headMat = new THREE.MeshStandardMaterial({ color: '#fff8d8', emissive: '#ffe9a0', emissiveIntensity: 1.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#ff4444', emissive: '#ff2222', emissiveIntensity: 0.9 });
  for (const z of [-0.8, 0.8]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.4), headMat);
    hl.position.set(5.24, 1.0, z);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.34), tailMat);
    tl.position.set(-5.24, 1.6, z);
    g.add(tl);
  }
  g.userData.headMat = headMat;
  g.userData.tailMat = tailMat;

  // wheels
  for (const wx of [3.8, -3.3, -1.8]) {
    for (const wz of [-1.15, 1.15]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 12), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.5, wz);
      g.add(wheel);
    }
  }
  return g;
}

export class Bus {
  group: THREE.Group;
  speed = 9;

  axis: 'x' | 'z' = 'x';
  dir: 1 | -1 = 1;
  private lane = 0;
  private waypoints: THREE.Vector2[];
  private wi = 0;
  private dwell = 0;
  private pendingStop: string | null = null;
  private cool = new Map<string, number>();
  private cur: number;
  private lightLvl = -1;

  constructor(seed = 1) {
    this.group = buildBusModel();
    this.group.rotation.y = seed % 2 ? 0 : Math.PI;
    this.cur = this.speed;

    // rectangular loop on the inner ring road (lane offsets follow the
    // same right-hand rules the cars spawn with)
    const c1 = roadCenter(1);
    const c2 = roadCenter(GRID - 1);
    this.waypoints = [
      new THREE.Vector2(c1 + 3, c1 + 3),
      new THREE.Vector2(c2 - 3, c1 + 3),
      new THREE.Vector2(c2 - 3, c2 - 3),
      new THREE.Vector2(c1 + 3, c2 - 3),
    ];
    if (seed % 2) this.wi = 2; // start on the opposite side sometimes
    this.deriveSeg();
    this.snapCross();
  }

  /** 0 = daytime, 1 = night (CitySystem drives this) */
  setLights(level: number): void {
    if (this.lightLvl === level) return;
    this.lightLvl = level;
    const head = this.group.userData.headMat as THREE.MeshStandardMaterial | undefined;
    const tail = this.group.userData.tailMat as THREE.MeshStandardMaterial | undefined;
    if (head) head.emissiveIntensity = 0.3 + level * 2.95;
    if (tail) tail.emissiveIntensity = 0.25 + level * 2.0;
  }

  /** axis/dir/lane for the leg toward waypoints[wi] */
  private deriveSeg(): void {
    const seg = this.wi;
    if (seg === 0) { this.axis = 'x'; this.dir = 1; this.lane = this.waypoints[0].y; }
    else if (seg === 1) { this.axis = 'z'; this.dir = 1; this.lane = this.waypoints[1].x; }
    else if (seg === 2) { this.axis = 'x'; this.dir = -1; this.lane = this.waypoints[2].y; }
    else { this.axis = 'z'; this.dir = -1; this.lane = this.waypoints[3].x; }

    this.group.rotation.y =
      this.axis === 'x' ? (this.dir === 1 ? 0 : Math.PI) : (this.dir === 1 ? -Math.PI / 2 : Math.PI / 2);
  }

  private snapCross(): void {
    if (this.axis === 'x') this.group.position.z = this.lane;
    else this.group.position.x = this.lane;
  }

  /** Stop the bus next to a stop for a few seconds (boarders/alighters) */
  update(
    dt: number,
    stops: THREE.Vector3[],
    traffic: TrafficSystem | null,
    now: number,
    leadGap = Infinity
  ): void {
    // wi indexes the LEG: waypoints[wi] → waypoints[wi+1]. Drive toward the
    // leg's END — aiming at the leg's start made the bus "arrive" instantly
    // and teleport around the rectangle every frame instead of driving.
    const target = this.waypoints[(this.wi + 1) % this.waypoints.length];
    const pos = this.axis === 'x' ? this.group.position.x : this.group.position.z;
    const wpCoord = this.axis === 'x' ? target.x : target.y;
    const distToWp = (wpCoord - pos) * this.dir;

    let desired = this.speed;

    // dwelling at a stop?
    if (this.dwell > 0) {
      this.dwell -= dt;
      desired = 0;
      if (this.dwell <= 0 && this.pendingStop) {
        this.cool.set(this.pendingStop, now + 40);
        this.pendingStop = null;
      }
    } else {
      // nearest unserved stop ahead on this leg
      let stopDist = Infinity;
      let stopKey: string | null = null;
      for (const s of stops) {
        const along = ((this.axis === 'x' ? s.x : s.z) - pos) * this.dir;
        const lateral = Math.abs((this.axis === 'x' ? s.z : s.x) - this.lane);
        if (along < 0.5 || along > 34 || lateral > 7) continue;
        const key = `${Math.round(s.x)},${Math.round(s.z)}`;
        const until = this.cool.get(key) ?? 0;
        if (until > now) continue;
        if (along < stopDist) { stopDist = along; stopKey = key; }
      }

      // red light?
      const ownCenter = this.axis === 'x' ? this.lane - this.dir * 3 : this.lane + this.dir * 3;
      const sig = nextSignalStop(traffic, this.axis, this.dir, pos, ownCenter);

      let block = Infinity;
      if (stopDist < sig) { block = stopDist; if (stopDist < 2.0) { this.dwell = 3.4; this.pendingStop = stopKey; } }
      else block = sig;

      if (block < 45) {
        desired = block <= 0.6 ? 0 : Math.min(this.speed, (block - 0.6) * 1.1);
      }
    }

    // keep a bumper gap to the vehicle ahead (heavy vehicle: gentler slope)
    if (leadGap < 45) {
      const allowed = leadGap <= 1 ? 0 : Math.min(this.speed, (leadGap - 1) * 1.05);
      if (allowed < desired) desired = allowed;
    }

    const rate = desired < this.cur ? 12 : 3.5; // heavy vehicle: slow to pull away
    this.cur += THREE.MathUtils.clamp(desired - this.cur, -rate * dt, rate * dt);
    const step = this.cur * this.dir * dt;

    if (this.axis === 'x') this.group.position.x += step;
    else this.group.position.z += step;

    // waypoint arrival → turn the corner
    if (this.dwell <= 0 && (distToWp <= 0.8 || distToWp < -6)) {
      this.wi = (this.wi + 1) % this.waypoints.length;
      this.deriveSeg();
      this.snapCross();
    }
  }
}
