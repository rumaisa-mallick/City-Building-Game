import * as THREE from 'three';
import { makeRng } from '../utils/textures';
import { nextSignalStop, type TrafficSystem } from '../systems/TrafficSystem';

export const bodyColors = ['#c43a3a', '#3a6ac4', '#d4d4d8', '#2a2a30', '#e8a03a', '#3ac47a', '#8a3ac4', '#f0f0f0'];

/** `car`/`taxi` are civilian; `patrol`/`garbage`/`mail` are city services */
export type CarKind = 'car' | 'taxi' | 'patrol' | 'garbage' | 'mail';

/** Simple car that drives along a road lane and wraps around the city. */
export class Car {
  group = new THREE.Group();
  speed: number;
  axis: 'x' | 'z';
  dir: 1 | -1;

  private lane: number;   // cross-coordinate of the lane (constant)
  private cur: number;    // current speed (brakes for red lights)
  private headMat: THREE.MeshStandardMaterial;
  private tailMat: THREE.MeshStandardMaterial;
  private flashMats: THREE.MeshStandardMaterial[] = []; // patrol light bar
  private t = 0;
  readonly kind: CarKind;
  private lightLvl = -1;
  private stalled = false; // breakdown event: stopped in lane, hazards blinking

  /** 0 = dim daytime running lights, 1 = full night beams (CitySystem drives) */
  setLights(level: number): void {
    if (this.lightLvl === level) return;
    this.lightLvl = level;
    this.headMat.emissiveIntensity = 0.3 + level * 2.95;
    this.tailMat.emissiveIntensity = 0.25 + level * 2.0;
  }

  /** Breakdown event: die in the lane (cars behind queue up) until towed */
  stall(on: boolean): void {
    this.stalled = on;
  }

  get isStalled(): boolean {
    return this.stalled;
  }

  constructor(axis: 'x' | 'z', dir: 1 | -1, lane: number, start: number, seed = 1, kind: CarKind = 'car') {
    this.axis = axis;
    this.dir = dir;
    this.lane = lane;
    this.kind = kind;
    const r = makeRng(seed);
    // per-kind performance: patrol hurries, service trucks crawl
    if (kind === 'patrol') this.speed = 10 + r() * 4;
    else if (kind === 'garbage') this.speed = 6 + r() * 2;
    else if (kind === 'mail') this.speed = 7 + r() * 2.5;
    else this.speed = 8 + r() * 7;
    this.cur = this.speed;

    const truck = kind === 'garbage' || kind === 'mail';
    const L = kind === 'garbage' ? 6.4 : kind === 'mail' ? 5.6 : 4.2;
    const bodyColor =
      kind === 'taxi' ? '#f2c21b' :
      kind === 'patrol' ? '#f0f2f5' :
      kind === 'garbage' ? '#2f6b46' :
      kind === 'mail' ? '#f4f6f8' :
      bodyColors[Math.floor(r() * bodyColors.length)];
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({ color: '#182530', roughness: 0.1, metalness: 0.8 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.9 });

    if (truck) {
      // cab up front, cargo box behind
      const cabLen = kind === 'garbage' ? 2.0 : 2.2;
      const cabX = L / 2 - cabLen / 2;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(cabLen, 1.8, 1.85), bodyMat);
      cab.position.set(cabX, 1.4, 0);
      cab.castShadow = true;
      this.group.add(cab);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 1.62), glassMat);
      shield.position.set(cabX + cabLen / 2 + 0.04, 1.75, 0);
      this.group.add(shield);
      const boxLen = L - cabLen - 0.25;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(boxLen, kind === 'garbage' ? 2.3 : 2.1, 1.9),
        bodyMat
      );
      box.position.set(-L / 2 + boxLen / 2, kind === 'garbage' ? 1.7 : 1.6, 0);
      box.castShadow = true;
      this.group.add(box);
      if (kind === 'garbage') {
        // darker rear hopper + lifting rails
        const hopMat = new THREE.MeshStandardMaterial({ color: '#254f36', roughness: 0.7, metalness: 0.3 });
        const hop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 1.94), hopMat);
        hop.position.set(-L / 2 + 0.25, 1.35, 0);
        this.group.add(hop);
      } else {
        // postal livery: blue band + red pinstripe along the box
        const blue = new THREE.MeshStandardMaterial({ color: '#1f4fa8', roughness: 0.45 });
        const band = new THREE.Mesh(new THREE.BoxGeometry(boxLen + 0.04, 0.4, 1.94), blue);
        band.position.set(-L / 2 + boxLen / 2, 1.05, 0);
        this.group.add(band);
        const red = new THREE.MeshStandardMaterial({ color: '#d93b34', roughness: 0.45 });
        const pin = new THREE.Mesh(new THREE.BoxGeometry(boxLen + 0.04, 0.1, 1.94), red);
        pin.position.set(-L / 2 + boxLen / 2, 1.34, 0);
        this.group.add(pin);
      }
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(L, 0.85, 1.85), bodyMat);
      body.position.y = 0.62;
      body.castShadow = true;
      this.group.add(body);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 1.7), glassMat);
      cabin.position.set(-0.25, 1.32, 0);
      cabin.castShadow = true;
      this.group.add(cabin);

      if (kind === 'patrol') {
        // navy flank stripe + roof light bar (flashes while driving)
        const navy = new THREE.MeshStandardMaterial({ color: '#1b3a7a', roughness: 0.45 });
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(L - 0.5, 0.3, 1.87), navy);
        stripe.position.y = 0.78;
        this.group.add(stripe);
        const barBase = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.1, 1.3),
          new THREE.MeshStandardMaterial({ color: '#22262c', roughness: 0.6 })
        );
        barBase.position.set(0, 1.72, 0);
        this.group.add(barBase);
        const redM = new THREE.MeshStandardMaterial({
          color: '#7a1512', emissive: new THREE.Color('#ff3b30'), emissiveIntensity: 2.2, roughness: 0.4,
        });
        const blueM = new THREE.MeshStandardMaterial({
          color: '#12275c', emissive: new THREE.Color('#2f6bff'), emissiveIntensity: 0.15, roughness: 0.4,
        });
        for (const [mat, z] of [[redM, -0.33], [blueM, 0.33]] as const) {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.56), mat);
          lamp.position.set(0, 1.82, z);
          this.group.add(lamp);
        }
        this.flashMats = [redM, blueM];
      }
    }

    if (kind === 'taxi') {
      // roof sign so cabs read as cabs from any angle
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.2, 0.42),
        new THREE.MeshStandardMaterial({ color: '#f7f7f2', emissive: '#fff2b0', emissiveIntensity: 0.5, roughness: 0.6 })
      );
      sign.position.set(-0.25, 1.78, 0);
      this.group.add(sign);
    }

    // wheels (trucks roll on more axles)
    const axles = kind === 'garbage' ? [2.2, -1.5, -2.5]
      : kind === 'mail' ? [1.7, -1.9]
      : [1.35, -1.35];
    for (const wx of axles) {
      for (const wz of [-0.95, 0.95]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12), wheelMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.36, wz);
        this.group.add(wheel);
      }
    }

    // lights
    this.headMat = new THREE.MeshStandardMaterial({ color: '#fff8d8', emissive: '#ffe9a0', emissiveIntensity: 1.1 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#ff4444', emissive: '#ff2222', emissiveIntensity: 0.9 });
    const lx = L / 2 - 0.02;
    for (const z of [-0.6, 0.6]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.34), this.headMat);
      hl.position.set(lx, 0.66, z);
      this.group.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.3), this.tailMat);
      tl.position.set(-lx, 0.68, z);
      this.group.add(tl);
    }

    // orient: cars face +x by default (body long axis = x) — at yaw ±π/2 the
    // nose points along -z for +π/2, so a southbound (+z) car needs -π/2
    if (axis === 'z') this.group.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    else this.group.rotation.y = dir === 1 ? 0 : Math.PI;

    if (axis === 'x') this.group.position.set(start, 0, lane);
    else this.group.position.set(lane, 0, start);
  }

  /** Half the vehicle length along travel — bumper-gap math in CitySystem */
  get halfLen(): number {
    return this.kind === 'garbage' ? 3.3 : this.kind === 'mail' ? 2.9 : 2.1;
  }

  update(dt: number, half: number, traffic?: TrafficSystem | null, leadGap = Infinity): void {
    const margin = 14;
    this.t += dt;

    // patrol light bar: alternating red / blue
    if (this.flashMats.length) {
      const red = Math.floor(this.t / 0.38) % 2 === 0;
      this.flashMats[0].emissiveIntensity = red ? 2.4 : 0.15;
      this.flashMats[1].emissiveIntensity = red ? 0.15 : 2.4;
    }

    // stalled breakdown: rear hazards blink until the tow arrives
    if (this.stalled) {
      const on = Math.floor(this.t / 0.42) % 2 === 0;
      this.tailMat.emissiveIntensity = on ? 2.6 : 0.12;
    }

    // brake for the next red light, otherwise cruise
    let desired = this.speed;
    if (traffic) {
      const t = this.axis === 'x' ? this.group.position.x : this.group.position.z;
      const ownCenter = this.axis === 'x' ? this.lane - this.dir * 3 : this.lane + this.dir * 3;
      const stop = nextSignalStop(traffic, this.axis, this.dir, t, ownCenter);
      if (stop < 45) {
        desired = stop <= 0.6 ? 0 : Math.min(this.speed, (stop - 0.6) * 1.1);
      }
    }
    // keep a bumper gap to the vehicle ahead: proportional following gives a
    // natural accordion (≈12 m at cruise, ~1 m at rest) — platoons, no overlap
    if (leadGap < 40) {
      const allowed = leadGap <= 1 ? 0 : Math.min(this.speed, (leadGap - 1) * 1.15);
      if (allowed < desired) desired = allowed;
    }
    if (this.stalled) desired = 0; // dead in its lane — everyone queues behind
    const rate = desired < this.cur ? 16 : 5; // brakes bite harder than the engine
    this.cur += THREE.MathUtils.clamp(desired - this.cur, -rate * dt, rate * dt);
    const step = this.cur * this.dir * dt;

    if (this.axis === 'x') {
      this.group.position.x += step;
      if (this.group.position.x > half + margin) this.group.position.x = -half - margin;
      if (this.group.position.x < -half - margin) this.group.position.x = half + margin;
    } else {
      this.group.position.z += step;
      if (this.group.position.z > half + margin) this.group.position.z = -half - margin;
      if (this.group.position.z < -half - margin) this.group.position.z = half + margin;
    }
  }
}