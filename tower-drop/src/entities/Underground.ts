import * as THREE from 'three';
import { strataTexture, trenchFloorTexture, gravelTexture } from '../utils/textures';

/**
 * Underground cutaway (⛏ / X): the north–south street at x=26 is sliced open
 * with four local clipping planes (attached by CitySystem.setCutaway), and
 * this class owns everything the cut reveals:
 *
 *  - geological strata walls and a bedrock floor, 7 m down
 *  - an open metro channel along the west side with a 3-car shuttle that
 *    eases along the trench and reverses at the buffer headwalls
 *  - gas / water / sewer mains bracketed to the east wall, with risers
 *  - orange-and-white safety hoarding along both cut edges
 *  - two warm work-lamps so the hole reads after dark
 *
 * The clip prism is exactly the road (x 20..32, z ±136): sidewalk boxes end
 * at x=20/32, so their faces form the cut edge and no lot, building or tree
 * ever stands over the hole.
 */
export const CUT = { x0: 20, x1: 32, z0: -136, z1: 136 };
export const CUT_DEPTH = 7;

export class Underground {
  /** everything inside the hole — hidden wholesale while the cutaway is closed */
  readonly group = new THREE.Group();
  /** four half-spaces whose union is the world *outside* the road prism */
  readonly planes: THREE.Plane[];

  private train = new THREE.Group();
  private trainZ = 0;
  private trainDir = 1;
  /** lamp material on the +z end — white when travelling north, red otherwise */
  private lampNorth = new THREE.MeshStandardMaterial({
    color: '#20242a', emissive: '#fff3d0', emissiveIntensity: 1.6, roughness: 0.4,
  });
  private lampSouth = new THREE.MeshStandardMaterial({
    color: '#20242a', emissive: '#ff4030', emissiveIntensity: 1.4, roughness: 0.4,
  });

  constructor() {
    // kept region = union of the outside half-spaces; with material.clipIntersection
    // a fragment survives if ANY plane keeps it, so only the prism interior vanishes.
    this.planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -CUT.x1),   // keep x ≥ 32
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), CUT.x0),   // keep x ≤ 20
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -CUT.z1),   // keep z ≥ 136
      new THREE.Plane(new THREE.Vector3(0, 0, -1), -CUT.z1),  // keep z ≤ -136
    ];

    const g = this.group;
    const dummy = new THREE.Object3D();
    const top = 0.16;                       // sidewalk height = lip of the cut
    const h = top + CUT_DEPTH;              // wall height: 0.16 → -7

    // --- strata walls (double-sided: grazing views catch the soil lip) ---
    const sideTex = strataTexture();
    sideTex.repeat.set(30, 1);              // a band cycle every ~9 m of wall
    const endTex = sideTex.clone();
    endTex.repeat.set(1.4, 1);
    endTex.needsUpdate = true;
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 1, side: THREE.DoubleSide });
    const endMat = new THREE.MeshStandardMaterial({ map: endTex, roughness: 1, side: THREE.DoubleSide });

    const wallY = top - h / 2;
    const spanZ = CUT.z1 - CUT.z0;
    const spanX = CUT.x1 - CUT.x0;

    const west = new THREE.Mesh(new THREE.PlaneGeometry(spanZ, h), sideMat);
    west.rotation.y = Math.PI / 2;
    west.position.set(CUT.x0 + 0.02, wallY, 0);
    west.receiveShadow = true;
    g.add(west);

    const east = new THREE.Mesh(new THREE.PlaneGeometry(spanZ, h), sideMat);
    east.rotation.y = -Math.PI / 2;
    east.position.set(CUT.x1 - 0.02, wallY, 0);
    east.receiveShadow = true;
    g.add(east);

    const south = new THREE.Mesh(new THREE.PlaneGeometry(spanX, h), endMat);
    south.position.set((CUT.x0 + CUT.x1) / 2, wallY, CUT.z0 + 0.02);
    south.receiveShadow = true;
    g.add(south);

    const north = new THREE.Mesh(new THREE.PlaneGeometry(spanX, h), endMat);
    north.rotation.y = Math.PI;
    north.position.set((CUT.x0 + CUT.x1) / 2, wallY, CUT.z1 - 0.02);
    north.receiveShadow = true;
    g.add(north);

    // --- bedrock floor ---
    const floorTex = trenchFloorTexture();
    floorTex.repeat.set(1.5, 34);           // ~8 m tiles down the 272 m trench
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX, spanZ),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((CUT.x0 + CUT.x1) / 2, -CUT_DEPTH, 0);
    floor.receiveShadow = true;
    g.add(floor);

    // --- buffer headwalls: concrete, 1.5 m shy of each trench end ---
    const concrete = new THREE.MeshStandardMaterial({ color: '#8e8b84', roughness: 0.9 });
    for (const z of [-134.5, 134.5]) {
      const hw = new THREE.Mesh(new THREE.BoxGeometry(spanX, 6.5, 0.6), concrete);
      hw.position.set((CUT.x0 + CUT.x1) / 2, -CUT_DEPTH + 3.25, z); // spans -7 → -0.5
      hw.castShadow = true;
      hw.receiveShadow = true;
      g.add(hw);
    }

    // --- open metro channel (west half of the prism) ---
    const trackTex = gravelTexture().clone(); // clone: the cache is shared
    trackTex.repeat.set(1, 54);
    trackTex.needsUpdate = true;
    const ballast = new THREE.Mesh(
      new THREE.PlaneGeometry(5.36, 269),
      new THREE.MeshStandardMaterial({ map: trackTex, roughness: 1 })
    );
    ballast.rotation.x = -Math.PI / 2;
    ballast.position.set(22.7, -CUT_DEPTH + 0.03, 0);
    ballast.receiveShadow = true;
    g.add(ballast);

    const sleeperMat = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.95 });
    const sleeperCount = 192;
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.16, 0.5), sleeperMat, sleeperCount);
    for (let i = 0; i < sleeperCount; i++) {
      dummy.position.set(22.7, -CUT_DEPTH + 0.11, -133.65 + i * 1.4);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      sleepers.setMatrixAt(i, dummy.matrix);
    }
    sleepers.instanceMatrix.needsUpdate = true;
    sleepers.receiveShadow = true;
    g.add(sleepers);

    const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.9, roughness: 0.3 });
    for (const x of [21.95, 23.45]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 269), steel);
      rail.position.set(x, -CUT_DEPTH + 0.27, 0); // rests on the sleepers
      rail.castShadow = true;
      g.add(rail);
    }

    // --- 3-car metro shuttle ---
    const carFloor = -CUT_DEPTH + 0.35;     // wheels sit on the rail heads
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 0.55, roughness: 0.35 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: '#5d646b', metalness: 0.4, roughness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#101820', metalness: 0.6, roughness: 0.15,
      emissive: '#ffcf8a', emissiveIntensity: 0.4, // lit interior through the cut
    });
    for (const off of [-9.6, 0, 9.6]) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.3, 9), bodyMat);
      body.position.y = carFloor + 1.15;
      body.castShadow = true;
      car.add(body);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.5, 8.6), skirtMat);
      skirt.position.y = carFloor + 0.25;
      car.add(skirt);
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.7, 7.6), glassMat);
      band.position.y = carFloor + 1.6;
      car.add(band);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 8.4), skirtMat);
      roof.position.y = carFloor + 2.34;
      car.add(roof);
      car.position.z = off;
      this.train.add(car);
    }
    // end lamps: colours swap with travel direction (see update())
    for (const [zEnd, mat] of [
      [14.15, this.lampNorth],
      [-14.15, this.lampSouth],
    ] as Array<[number, THREE.MeshStandardMaterial]>) {
      for (const lx of [-0.8, 0.8]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.08), mat);
        lamp.position.set(lx, carFloor + 0.7, zEnd);
        this.train.add(lamp);
      }
    }
    this.train.position.set(22.7, 0, 0);
    g.add(this.train);

    // --- utility mains bracketed to the east wall ---
    const pipeDefs: Array<[y: number, rad: number, color: string]> = [
      [-1.3, 0.18, '#3f7fbf'], // water
      [-2.0, 0.14, '#c9a227'], // gas
      [-2.9, 0.22, '#6f757c'], // sewer
    ];
    for (const [y, rad, color] of pipeDefs) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad, 269, 12),
        new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.45 })
      );
      pipe.rotation.x = Math.PI / 2;        // cylinder axis → z
      pipe.position.set(31.4, y, 0);
      pipe.castShadow = true;
      g.add(pipe);
    }

    const bracketCount = 45 * pipeDefs.length;
    const brackets = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.5, 0.14),
      new THREE.MeshStandardMaterial({ color: '#55595e', metalness: 0.6, roughness: 0.5 }),
      bracketCount
    );
    let bi = 0;
    for (const [y] of pipeDefs) {
      for (let k = 0; k < 45; k++) {
        dummy.position.set(31.7, y, -132 + k * 6);
        dummy.updateMatrix();
        brackets.setMatrixAt(bi++, dummy.matrix);
      }
    }
    brackets.instanceMatrix.needsUpdate = true;
    g.add(brackets);

    // risers climbing from the water main, valve-capped just under the lip
    const riserMat = new THREE.MeshStandardMaterial({ color: '#8a9096', metalness: 0.5, roughness: 0.5 });
    for (const z of [-96, -36, 24, 84]) {
      const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.92, 10), riserMat);
      riser.position.set(31.4, -0.66, z);   // from the water main up to y ≈ -0.2
      g.add(riser);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), riserMat);
      cap.position.set(31.4, -0.14, z);
      g.add(cap);
    }

    // --- safety hoarding along both cut edges ---
    const panelGeo = new THREE.BoxGeometry(0.06, 0.72, 2.3);
    const panelMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    const perSide = 104;
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, perSide * 2);
    const cOrange = new THREE.Color('#e8622a');
    const cWhite = new THREE.Color('#e9e6de');
    let pi = 0;
    for (const x of [CUT.x0 + 0.06, CUT.x1 - 0.06]) {
      for (let i = 0; i < perSide; i++) {
        dummy.position.set(x, top + 0.36, -135 + i * 2.6);
        dummy.updateMatrix();
        panels.setMatrixAt(pi, dummy.matrix);
        panels.setColorAt(pi, i & 1 ? cWhite : cOrange);
        pi++;
      }
    }
    panels.instanceMatrix.needsUpdate = true;
    if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
    panels.castShadow = true;
    g.add(panels);

    // --- work-lamps: live inside the group, so hiding the cut turns them off ---
    for (const z of [-55, 55]) {
      const lamp = new THREE.PointLight('#ffb066', 60, 60, 2);
      lamp.position.set(26, -4.2, z);
      g.add(lamp);
    }

    // hidden until the cutaway is opened
    g.visible = false;
  }

  /** World (x, z) inside the open excavation */
  contains(x: number, z: number): boolean {
    return x > CUT.x0 && x < CUT.x1 && z > CUT.z0 && z < CUT.z1;
  }

  /** Per-frame while open: run the shuttle and swap head/tail lamp colours */
  update(dt: number): void {
    const limit = 116; // nose stops short of the buffer headwall at ±134.5
    const near = Math.max(0, (limit - Math.abs(this.trainZ)) / 12);
    const speed = 9 * (0.25 + 0.75 * Math.min(1, near)); // eases into the buffers
    this.trainZ += this.trainDir * speed * dt;
    if (this.trainZ >= limit) { this.trainZ = limit; this.trainDir = -1; }
    else if (this.trainZ <= -limit) { this.trainZ = -limit; this.trainDir = 1; }
    this.train.position.z = this.trainZ;

    const northbound = this.trainDir > 0;
    this.lampNorth.emissive.set(northbound ? '#fff3d0' : '#ff4030');
    this.lampSouth.emissive.set(northbound ? '#ff4030' : '#fff3d0');
  }
}
