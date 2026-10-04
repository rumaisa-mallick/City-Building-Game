import * as THREE from 'three';
import { makeRng } from '../utils/textures';

/** Procedural citizen names — zero assets, 24 × 24 combinations */
const FIRST_NAMES = [
  'Maya', 'Leo', 'Aisha', 'Tomás', 'Ingrid', 'Kenji', 'Zara', 'Marcus',
  'Elena', 'Priya', 'Omar', 'Nora', 'Felix', 'Amara', 'Hugo', 'Sofia',
  'Dmitri', 'Leila', 'Jonas', 'Rosa', 'Tariq', 'Vera', 'Mateo', 'Lena',
];
const LAST_NAMES = [
  'Chen', 'Okonkwo', 'Silva', 'Nakamura', 'Larsson', 'Haddad', 'Petrov', 'Moreau',
  'Kowalski', 'Reyes', 'Andersen', 'Bauer', 'Ivanova', 'Costa', 'Yamada', 'Novak',
  'Fischer', 'Okafor', 'Bianchi', 'Volkov', 'Lindqvist', 'Dubois', 'Marino', 'Sharma',
];

/**
 * A walking human: simple articulated figure with
 * swinging legs/arms and a slight body bob.
 */
export class Person {
  group = new THREE.Group();
  speed: number;
  /** Citizen name — selection card + newspaper (re-applied on save-load) */
  name: string;
  /** true while the select tool is carrying it (update() stands still) */
  frozen = false;
  /** rain/snow umbrella state — CitySystem.setUmbrella toggles it every frame */
  umbrellaOn = false;
  readonly umbrella = new THREE.Group();

  private path: THREE.Vector3[];
  /** per-waypoint curb gates: checked before stepping past that waypoint */
  private gates: Array<(() => boolean) | null>;
  private idx = 0;
  private phase = 0;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private body: THREE.Group;

  constructor(path: THREE.Vector3[], seed = 1, gates?: Array<(() => boolean) | null>) {
    this.path = path.length > 1 ? path : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 0, 0)];
    this.gates = gates ?? [];
    const r = makeRng(seed);
    this.speed = 1.1 + r() * 0.8;
    // identity rolls from a separate stream so speed/colour rolls stay unchanged
    const ir = makeRng((seed + 0x51ed) >>> 0);
    this.name =
      `${FIRST_NAMES[Math.floor(ir() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(ir() * LAST_NAMES.length)]}`;

    const skins = ['#e8b48c', '#d99873', '#8d5524', '#f1c9a5', '#c68642'];
    const shirts = ['#d94f4f', '#4f7ad9', '#4fd97a', '#e0c34a', '#d96ad9', '#f0f0f0', '#3a3a44', '#e8813a'];
    const pants = ['#2a2e38', '#3a4a6a', '#4a4a4a', '#5a4030', '#243044'];
    const hairs = ['#2b2b2b', '#4a3621', '#6b4423', '#1a1a1a', '#8a6a3a'];

    const skin = new THREE.MeshStandardMaterial({ color: skins[Math.floor(r() * skins.length)], roughness: 0.85 });
    const shirt = new THREE.MeshStandardMaterial({ color: shirts[Math.floor(r() * shirts.length)], roughness: 0.9 });
    const pant = new THREE.MeshStandardMaterial({ color: pants[Math.floor(r() * pants.length)], roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: hairs[Math.floor(r() * hairs.length)], roughness: 1 });

    this.body = new THREE.Group();

    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.6, 0.22), shirt);
    torso.position.y = 1.15;
    torso.castShadow = true;
    this.body.add(torso);

    // head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin);
    head.position.y = 1.6;
    head.castShadow = true;
    this.body.add(head);
    const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.26), hair);
    hairMesh.position.y = 1.74;
    this.body.add(hairMesh);

    // legs (pivot at hip)
    const mkLeg = (x: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.85, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 0.16), pant);
      leg.position.y = -0.4;
      leg.castShadow = true;
      pivot.add(leg);
      return pivot;
    };
    this.legL = mkLeg(-0.1);
    this.legR = mkLeg(0.1);
    this.group.add(this.body, this.legL, this.legR);

    // arms (pivot at shoulder)
    const mkArm = (x: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.42, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 0.13), shirt);
      arm.position.y = -0.29;
      arm.castShadow = true;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.13), skin);
      hand.position.y = -0.6;
      pivot.add(hand);
      return pivot;
    };
    this.armL = mkArm(-0.26);
    this.armR = mkArm(0.26);
    this.group.add(this.armL, this.armR);

    // umbrella: sits in the raised right hand; hidden until it precipitates
    const umbColors = ['#d94f4f', '#4f7ad9', '#f0f0f0', '#2a2e38', '#4fd97a', '#e0c34a', '#8a6a3a', '#c46bd9'];
    this.umbrella.position.set(0.26, 0, 0.58);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.58, 0.28, 10),
      new THREE.MeshStandardMaterial({ color: umbColors[Math.floor(r() * umbColors.length)], roughness: 0.6, side: THREE.DoubleSide })
    );
    canopy.position.y = 2.06;
    canopy.castShadow = true;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6),
      new THREE.MeshStandardMaterial({ color: '#2b2e34', roughness: 0.5 })
    );
    pole.position.y = 1.62;
    this.umbrella.add(canopy, pole);
    this.umbrella.visible = false;
    this.group.add(this.umbrella);

    // start on path
    this.group.position.copy(this.path[0]);
    this.idx = 1 % this.path.length;

    // editable via select/bulldoze tools (people are saved by count, not record)
    this.group.userData.editable = true;
    this.group.userData.kind = 'person';
    this.group.userData.person = this;
  }

  /** Shift the walk loop by a delta — used when the select tool drops it */
  shiftPath(dx: number, dy: number, dz: number): void {
    for (const p of this.path) {
      p.x += dx;
      p.z += dz;
      p.y += dy;
    }
  }

  /** Open/close the umbrella (rain, storm or falling snow) — safe per-frame */
  setUmbrella(on: boolean): void {
    if (this.umbrellaOn === on) return;
    this.umbrellaOn = on;
    this.umbrella.visible = on;
  }

  update(dt: number): void {
    if (this.frozen) return;
    const target = this.path[this.idx];
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.6) {
      // a curb gate: wait here until the crossing light gives us walk
      const gate = this.gates[this.idx];
      if (gate && !gate()) {
        const nxt = this.path[(this.idx + 1) % this.path.length];
        const fx = nxt.x - this.group.position.x;
        const fz = nxt.z - this.group.position.z;
        if (Math.abs(fx) + Math.abs(fz) > 0.05) {
          const targetRot = Math.atan2(fx, fz);
          let d = targetRot - this.group.rotation.y;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          this.group.rotation.y += d * Math.min(1, dt * 6);
        }
        // relax limbs to a neutral standing pose
        const k = 1 - Math.min(1, dt * 8);
        this.legL.rotation.x *= k;
        this.legR.rotation.x *= k;
        this.armL.rotation.x *= k;
        const restR = this.umbrellaOn ? -1.55 : 0;
        this.armR.rotation.x += (restR - this.armR.rotation.x) * (1 - k);
        this.body.position.y = 0;
        return;
      }
      this.idx = (this.idx + 1) % this.path.length;
    } else {
      const inv = 1 / dist;
      this.group.position.x += dx * inv * this.speed * dt;
      this.group.position.z += dz * inv * this.speed * dt;
      const targetRot = Math.atan2(dx, dz);
      // smooth turn
      let diff = targetRot - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += diff * Math.min(1, dt * 6);
    }

    // walk cycle
    this.phase += dt * this.speed * 4.2;
    const swing = Math.sin(this.phase);
    this.legL.rotation.x = swing * 0.55;
    this.legR.rotation.x = -swing * 0.55;
    this.armL.rotation.x = -swing * 0.4;
    if (this.umbrellaOn) {
      // right arm holds the umbrella up instead of swinging
      const target = -1.55 + swing * 0.08;
      this.armR.rotation.x += (target - this.armR.rotation.x) * Math.min(1, dt * 10);
    } else {
      this.armR.rotation.x = swing * 0.4;
    }
    this.body.position.y = Math.abs(Math.sin(this.phase * 2)) * 0.035;
  }
}