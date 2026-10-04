import * as THREE from 'three';
import { makeRng } from '../utils/textures';
import type { AnimalType, PlaceableKind } from '../types';

// ============================================================================
// Animals: dog, cat, duck, cow. Procedural low-poly quadrupeds that wander
// a small loop around their placement point (same waypoint walk as Person).
// ============================================================================

interface Rig {
  group: THREE.Group;
  legs: THREE.Group[];
  body: THREE.Group;
  tail: THREE.Group | null;
  waddle: boolean;
}

const SPEEDS: Record<AnimalType, number> = { dog: 1.7, cat: 1.25, duck: 0.7, cow: 0.6 };

function buildRig(type: AnimalType, r: () => number): Rig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const legs: THREE.Group[] = [];
  let tail: THREE.Group | null = null;

  const mat = (c: string | string[], rough = 0.9): THREE.MeshStandardMaterial => {
    const color = Array.isArray(c) ? c[Math.floor(r() * c.length)] : c;
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  };
  const addLeg = (x: number, z: number, len: number, w: number, m: THREE.Material, target = group): void => {
    const pivot = new THREE.Group();
    pivot.position.set(x, len, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), m);
    leg.castShadow = true;
    leg.position.y = -len / 2;
    pivot.add(leg);
    target.add(pivot);
    legs.push(pivot);
  };

  if (type === 'dog') {
    const fur = mat(['#c98d4e', '#8a5a33', '#40403e', '#e2cfa8', '#5c4632']);
    const dark = mat('#3a2f26');
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.92), fur);
    torso.castShadow = true;
    torso.position.y = 0.56;
    body.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.2), mat('#efe6d8'));
    chest.position.set(0, 0.5, 0.42);
    body.add(chest);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.38), fur);
    head.castShadow = true;
    head.position.set(0, 0.86, 0.56);
    body.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.2), fur);
    snout.position.set(0, 0.8, 0.8);
    body.add(snout);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.06), dark);
    nose.position.set(0, 0.83, 0.9);
    body.add(nose);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.14), fur);
      ear.position.set(0.12 * s, 1.06, 0.5);
      ear.rotation.z = 0.25 * s;
      ear.castShadow = true;
      body.add(ear);
    }
    tail = new THREE.Group();
    tail.position.set(0, 0.72, -0.46);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.36, 0.09), fur);
    t.position.y = 0.18;
    tail.add(t);
    tail.rotation.x = -0.7;
    body.add(tail);
    addLeg(-0.15, 0.32, 0.36, 0.12, fur);
    addLeg(0.15, 0.32, 0.36, 0.12, fur);
    addLeg(-0.15, -0.32, 0.36, 0.12, fur);
    addLeg(0.15, -0.32, 0.36, 0.12, fur);
  } else if (type === 'cat') {
    const fur = mat(['#8b8b8b', '#d98b3d', '#f0ead8', '#3a3a3a', '#b0a08a']);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.66), fur);
    torso.castShadow = true;
    torso.position.y = 0.4;
    body.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.24), fur);
    head.castShadow = true;
    head.position.set(0, 0.6, 0.42);
    body.add(head);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.08), mat('#e8c9c0'));
    muzzle.position.set(0, 0.56, 0.56);
    body.add(muzzle);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), fur);
      ear.position.set(0.09 * s, 0.78, 0.4);
      ear.rotation.z = -0.12 * s;
      ear.castShadow = true;
      body.add(ear);
    }
    tail = new THREE.Group();
    tail.position.set(0, 0.5, -0.32);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), fur);
    t.position.y = 0.25;
    tail.add(t);
    tail.rotation.x = -0.5;
    body.add(tail);
    addLeg(-0.11, 0.22, 0.26, 0.08, fur);
    addLeg(0.11, 0.22, 0.26, 0.08, fur);
    addLeg(-0.11, -0.22, 0.26, 0.08, fur);
    addLeg(0.11, -0.22, 0.26, 0.08, fur);
  } else if (type === 'duck') {
    const feathers = mat(['#f5efe0', '#f2d77e', '#e8e2d0']);
    const orange = mat('#e8913a', 0.7);
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), feathers);
    torso.scale.set(0.85, 0.78, 1.25);
    torso.castShadow = true;
    torso.position.y = 0.34;
    body.add(torso);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), feathers);
      wing.scale.set(0.4, 0.8, 1.5);
      wing.position.set(s * 0.24, 0.38, -0.02);
      body.add(wing);
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8), feathers);
    neck.position.set(0, 0.56, 0.26);
    neck.rotation.x = 0.25;
    body.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), feathers);
    head.castShadow = true;
    head.position.set(0, 0.74, 0.32);
    body.add(head);
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.18), orange);
    beak.position.set(0, 0.71, 0.48);
    body.add(beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), mat('#1c1c1c', 0.4));
      eye.position.set(s * 0.09, 0.78, 0.4);
      body.add(eye);
    }
    tail = new THREE.Group();
    tail.position.set(0, 0.4, -0.34);
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), feathers);
    t.rotation.x = -Math.PI / 2 - 0.5;
    t.position.z = -0.12;
    tail.add(t);
    body.add(tail);
    addLeg(-0.1, 0.05, 0.16, 0.05, orange);
    addLeg(0.1, 0.05, 0.16, 0.05, orange);
    // ducks "walk" with their whole body — legs are mostly decorative
  } else { // cow
    const hide = mat(['#f0ece2', '#e8dfd0']);
    const black = mat('#2e2e30');
    const muzzle = mat('#d8a7a0');
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.85, 1.6), hide);
    torso.castShadow = true;
    torso.position.y = 1.15;
    body.add(torso);
    // spots
    for (let n = 0; n < 4; n++) {
      const side = n % 2 ? 1 : -1;
      const spot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3 + r() * 0.25, 0.35 + r() * 0.35), black);
      spot.position.set(side * 0.44, 1.05 + r() * 0.3, -0.5 + r() * 1.0);
      body.add(spot);
    }
    const topSpot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.6), black);
    topSpot.position.set(0.1, 1.58, 0.1);
    body.add(topSpot);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), hide);
    head.castShadow = true;
    head.position.set(0, 1.35, 1.0);
    body.add(head);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.24, 0.2), muzzle);
    nose.position.set(0, 1.24, 1.32);
    body.add(nose);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), mat('#ded4bc'));
      horn.position.set(s * 0.24, 1.62, 0.98);
      horn.rotation.z = -s * 0.5;
      body.add(horn);
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.24), hide);
      ear.position.set(s * 0.32, 1.44, 0.95);
      ear.rotation.z = s * 0.3;
      body.add(ear);
    }
    tail = new THREE.Group();
    tail.position.set(0, 1.45, -0.8);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.8, 6), hide);
    t.position.y = -0.4;
    tail.add(t);
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), black);
    tuft.position.y = -0.82;
    tail.add(tuft);
    tail.rotation.x = 0.3;
    body.add(tail);
    addLeg(-0.3, 0.55, 0.7, 0.17, hide);
    addLeg(0.3, 0.55, 0.7, 0.17, hide);
    addLeg(-0.3, -0.55, 0.7, 0.17, hide);
    addLeg(0.3, -0.55, 0.7, 0.17, hide);
  }

  return { group, legs, body, tail, waddle: type === 'duck' };
}

/** Plain model for ghost previews (no actor state) */
export function createAnimal(type: AnimalType, seed = 1): THREE.Group {
  const rig = buildRig(type, makeRng(seed));
  const g = rig.group;
  g.userData.editable = true;
  g.userData.kind = type as PlaceableKind;
  g.userData.record = { kind: type as PlaceableKind, position: [0, 0, 0], rotationY: 0 };
  return g;
}

export class Animal {
  group: THREE.Group;
  speed: number;
  /** true while the select tool is carrying it (update() stands still) */
  frozen = false;

  private path: THREE.Vector3[];
  private idx = 1;
  private phase = 0;
  private rig: Rig;

  constructor(type: AnimalType, path: THREE.Vector3[], seed = 1) {
    this.rig = buildRig(type, makeRng(seed));
    this.group = this.rig.group;
    this.path = path.length > 1 ? path : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0)];
    this.speed = SPEEDS[type] * (0.85 + makeRng(seed + 7)() * 0.35);
    this.group.position.copy(this.path[0]);
    this.idx = 1 % this.path.length;

    this.group.userData.editable = true;
    this.group.userData.kind = type as PlaceableKind;
    this.group.userData.record = {
      kind: type as PlaceableKind,
      position: [this.path[0].x, this.path[0].y, this.path[0].z],
      rotationY: 0,
    };
    this.group.userData.animal = this;
  }

  update(dt: number): void {
    if (this.frozen) return;
    const target = this.path[this.idx];
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.4) {
      this.idx = (this.idx + 1) % this.path.length;
    } else {
      const inv = 1 / dist;
      this.group.position.x += dx * inv * this.speed * dt;
      this.group.position.z += dz * inv * this.speed * dt;
      const targetRot = Math.atan2(dx, dz);
      let diff = targetRot - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += diff * Math.min(1, dt * 6);
    }

    // gait: diagonal leg pairs swing together (trot)
    this.phase += dt * this.speed * 5;
    const swing = Math.sin(this.phase);
    this.rig.legs.forEach((leg, i) => {
      leg.rotation.x = swing * ((i === 0 || i === 3) ? 0.5 : -0.5);
    });
    this.rig.body.position.y = Math.abs(Math.sin(this.phase * 2)) * 0.025;
    if (this.rig.tail) this.rig.tail.rotation.y = Math.sin(this.phase * 1.4) * 0.45;
    if (this.rig.waddle) this.rig.body.rotation.z = Math.sin(this.phase) * 0.12;
  }

  /** Shift the wander loop by a delta — used when the select tool drops it */
  shiftPath(dx: number, dy: number, dz: number): void {
    for (const p of this.path) {
      p.x += dx;
      p.z += dz;
      p.y += dy;
    }
    const rec = this.group.userData.record as { position: [number, number, number] } | undefined;
    if (rec) {
      rec.position = [this.group.position.x, this.group.position.y, this.group.position.z];
    }
  }
}
