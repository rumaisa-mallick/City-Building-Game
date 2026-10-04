import * as THREE from 'three';

/**
 * Construction site: a sandy foundation pad plus a tower crane that swings
 * a load while the building next to it rises out of the ground.
 * Fully procedural — no assets.
 */

export interface ConstructionSite {
  /** Sibling rig added next to the building (world-positioned by the caller) */
  group: THREE.Group;
  /** Drive crane animation from a global clock */
  update(t: number): void;
  /** Remove and free GPU resources */
  dispose(): void;
}

const YELLOW = () => new THREE.MeshStandardMaterial({ color: '#f2b134', roughness: 0.55, metalness: 0.15 });
const DARK = () => new THREE.MeshStandardMaterial({ color: '#41454b', roughness: 0.8 });
const CONCRETE = () => new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.9 });
const SAND = () => new THREE.MeshStandardMaterial({ color: '#c9b083', roughness: 1 });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function createConstructionSite(opts: {
  w: number;          // lot width (local x)
  d: number;          // lot depth (local z)
  baseY: number;      // ground y of the finished building
  height: number;     // final building height
  rotY: number;       // matches the building's rotation
  x: number;
  z: number;
}): ConstructionSite {
  const { w, d, baseY, height, rotY, x, z } = opts;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;

  // ---- foundation pad ----
  const pad = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w - 0.4, 4), 0.2, Math.max(d - 0.4, 4)), SAND());
  pad.position.set(0, baseY + 0.1, 0);
  pad.receiveShadow = true;
  group.add(pad);

  // orange site barriers around the pad corners
  const barrierMat = new THREE.MeshStandardMaterial({ color: '#e8762c', roughness: 0.7 });
  const bx = Math.max(w - 0.4, 4) / 2;
  const bz = Math.max(d - 0.4, 4) / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    group.add(box(0.5, 0.7, 0.5, barrierMat, sx * bx, baseY + 0.45, sz * bz));
  }

  // ---- tower crane (stands beside the lot) ----
  const crane = new THREE.Group();
  crane.position.set(w / 2 + 3.2, 0, 0);
  group.add(crane);

  const mastH = height + 7;
  crane.add(box(3, 0.8, 3, CONCRETE(), 0, 0.4, 0));
  crane.add(box(0.85, mastH, 0.85, YELLOW(), 0, 0.8 + mastH / 2, 0));
  // lattice stripes
  const braces = 9;
  for (let i = 1; i <= braces; i++) {
    crane.add(box(1.0, 0.1, 1.0, DARK(), 0, 0.8 + (i * mastH) / (braces + 1), 0));
  }
  // apex pyramid
  const apex = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 4), YELLOW());
  apex.position.y = 0.8 + mastH + 0.9;
  apex.castShadow = true;
  apex.rotation.y = Math.PI / 4;
  crane.add(apex);

  // ---- jib assembly (rotates around the mast top) ----
  const topY = 0.8 + mastH + 0.4;
  const jibPivot = new THREE.Group();
  jibPivot.position.y = topY;
  crane.add(jibPivot);

  const Lj = Math.max(9, height * 0.62);
  const jib = box(Lj, 0.5, 0.45, YELLOW(), Lj / 2, 0, 0);
  jib.castShadow = true;
  jibPivot.add(jib);
  jibPivot.add(box(Lj * 0.42, 0.45, 0.4, YELLOW(), -Lj * 0.21, 0, 0));
  jibPivot.add(box(1.3, 1.1, 1.2, CONCRETE(), -Lj * 0.44, 0, 0));

  // trolley + cable + hook + hanging panel
  const trolleyG = new THREE.Group();
  jibPivot.add(trolleyG);
  trolleyG.add(box(0.6, 0.3, 0.5, DARK(), 0, -0.35, 0));

  const cableMat = DARK();
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 5), cableMat);
  cable.castShadow = false;
  trolleyG.add(cable);

  const hook = box(0.4, 0.5, 0.4, YELLOW(), 0, 0, 0);
  trolleyG.add(hook);
  const load = box(1.8, 0.7, 0.5, CONCRETE(), 0, 0, 0);
  trolleyG.add(load);

  const dropMax = Math.max(4, height * 0.55);

  return {
    group,
    update(t: number): void {
      // slow sweep + trolley travel + bobbing load
      jibPivot.rotation.y = Math.sin(t * 0.17) * 0.75;
      const slide = 0.42 + Math.sin(t * 0.31) * 0.24;
      trolleyG.position.x = Lj * slide;
      const drop = 2.2 + (Math.sin(t * 0.45 + 1.3) * 0.5 + 0.5) * dropMax;
      cable.scale.y = drop;
      cable.position.y = -drop / 2 - 0.35;
      hook.position.y = -drop - 0.55;
      load.position.y = -drop - 1.35;
    },
    dispose(): void {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else if (mat) (mat as THREE.Material).dispose();
        }
      });
      group.parent?.remove(group);
    },
  };
}
