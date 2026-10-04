import * as THREE from 'three';
import { makeRng } from '../utils/textures';
import { nextSignalStop, type TrafficSystem } from '../systems/TrafficSystem';

const shirtColors = ['#e05252', '#4a90d9', '#e8d44d', '#57b894', '#b06fd8', '#e8873a'];

/**
 * A cyclist riding the green bike lane: same right-hand lane discipline,
 * signal braking and map wrap-around as cars — just slower, and the model
 * is a bike with a rider whose wheels actually spin.
 */
export class Cyclist {
  group = new THREE.Group();
  speed: number;
  axis: 'x' | 'z';
  dir: 1 | -1;

  private center: number;  // road center this street belongs to
  private lane: number;    // cross-coordinate of the bike lane
  private cur: number;
  private wheels: THREE.Mesh[] = [];

  constructor(axis: 'x' | 'z', dir: 1 | -1, center: number, start: number, seed = 1) {
    this.axis = axis;
    this.dir = dir;
    this.center = center;
    const r = makeRng(seed);
    this.speed = 5.5 + r() * 2.5;
    this.cur = this.speed;

    // bike lane sits on the right-hand edge of the roadway
    this.lane = axis === 'x' ? center + dir * 4.8 : center - dir * 4.8;

    const frameMat = new THREE.MeshStandardMaterial({ color: '#26292f', roughness: 0.5, metalness: 0.4 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#17171a', roughness: 0.95 });
    const shirt = new THREE.MeshStandardMaterial({
      color: shirtColors[Math.floor(r() * shirtColors.length)], roughness: 0.85,
    });
    const skin = new THREE.MeshStandardMaterial({ color: '#e8b98e', roughness: 0.9 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: '#d94f3d', roughness: 0.5 });

    // wheels: torus lies in the XY plane → axle across the bike (local Z)
    const wheelGeo = new THREE.TorusGeometry(0.34, 0.055, 8, 18);
    for (const wx of [1.05, -1.05]) {
      const w = new THREE.Mesh(wheelGeo, rubber);
      w.position.set(wx, 0.34, 0);
      this.group.add(w);
      this.wheels.push(w);
    }

    // frame
    const tube = (len: number, x: number, y: number, rz: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), frameMat);
      m.position.set(x, y, 0);
      m.rotation.z = rz;
      this.group.add(m);
    };
    tube(1.55, 0.1, 0.6, 0.2);        // lower tube
    tube(1.35, -0.15, 0.86, -0.08);   // top tube
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.07), frameMat);
    post.position.set(-0.64, 0.72, 0);
    this.group.add(post);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.18), rubber);
    seat.position.set(-0.7, 1.0, 0);
    this.group.add(seat);
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.07), frameMat);
    fork.position.set(0.94, 0.7, 0);
    fork.rotation.z = -0.28;
    this.group.add(fork);
    const bars = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.52), frameMat);
    bars.position.set(0.84, 1.02, 0);
    this.group.add(bars);

    // rider: leaning torso, arms to the bars, head under a helmet
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.3), shirt);
    torso.position.set(-0.3, 1.38, 0);
    torso.rotation.z = -0.55;
    torso.castShadow = true;
    this.group.add(torso);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.09, 0.09), shirt);
    arm.position.set(0.24, 1.3, 0);
    arm.rotation.z = -0.38;
    this.group.add(arm);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
    head.position.set(0.2, 1.7, 0);
    head.castShadow = true;
    this.group.add(head);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.185, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      helmetMat
    );
    helmet.position.set(0.2, 1.73, 0);
    this.group.add(helmet);

    // orient & place exactly like Car (model faces +x by default; southbound → -π/2)
    if (axis === 'z') this.group.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    else this.group.rotation.y = dir === 1 ? 0 : Math.PI;
    if (axis === 'x') this.group.position.set(start, 0, this.lane);
    else this.group.position.set(this.lane, 0, start);
  }

  update(dt: number, half: number, traffic?: TrafficSystem | null): void {
    const margin = 14;

    // brake for red lights like everyone else
    let desired = this.speed;
    if (traffic) {
      const t = this.axis === 'x' ? this.group.position.x : this.group.position.z;
      const stop = nextSignalStop(traffic, this.axis, this.dir, t, this.center);
      if (stop < 40) {
        desired = stop <= 0.6 ? 0 : Math.min(this.speed, (stop - 0.6));
      }
    }
    const rate = desired < this.cur ? 9 : 4.5; // bikes brake/accelerate softer than cars
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

    // rolling wheels (model always travels along its local +x)
    const spin = (this.cur * dt) / 0.34;
    for (const w of this.wheels) w.rotation.z -= spin;
  }
}
