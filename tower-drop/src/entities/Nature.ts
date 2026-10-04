import * as THREE from 'three';
import type { PlaceableKind, TreeType, Season } from '../types';
import { grassTuftTexture, makeRng } from '../utils/textures';
import { registerLamp } from '../utils/materialRegistry';

// Shared materials.
// Foliage is smooth-shaded: IcosahedronGeometry with detail > 0 already stores
// per-vertex sphere normals (three calls normalizeNormals(), not
// computeVertexNormals()), so the flatShading flag was the only thing faceting
// them — it makes the shader take normals from screen-space derivatives instead,
// which turned every canopy into a cut-glass polyhedron. Dropping it rounds the
// crowns and lets light wrap around them the way it does on real foliage.
const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 1 });
const birchTrunkMat = new THREE.MeshStandardMaterial({ color: '#d8d4c8', roughness: 0.9 });
const leafMats = [
  new THREE.MeshStandardMaterial({ color: '#3f7a34', roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: '#4f8f3f', roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: '#357030', roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: '#5a9c48', roughness: 1 }),
];
const pineMats = [
  new THREE.MeshStandardMaterial({ color: '#2d5c2f', roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: '#245028', roughness: 1 }),
];
const metalMat = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.6 });
const woodMat = new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 0.9 });

// originals kept so seasons can swap palettes and snow can dust them white
const leafColors = leafMats.map((m) => m.color.clone());
const pineColors = pineMats.map((m) => m.color.clone());
const SNOW_TINT = new THREE.Color('#e9eef4');
const SEASON_LEAF: Record<'spring' | 'autumn', string[]> = {
  spring: ['#7cc45f', '#8fd06b', '#6bb557', '#a3dd82'],   // fresh, light greens
  autumn: ['#d98a2b', '#c4542a', '#e0b13a', '#a8412a'],   // orange / red / gold
};
const SEASON_PINE: Record<'spring' | 'autumn', string[]> = {
  spring: ['#2f6b34', '#286030'],
  autumn: ['#4a6b30', '#3f5e2a'],                          // evergreens go olive
};
let seasonLeaf = leafColors;
let seasonPine = pineColors;
let foliageSnow = false;

function paintFoliage(): void {
  leafMats.forEach((m, i) => {
    m.color.copy(seasonLeaf[i]);
    if (foliageSnow) m.color.lerp(SNOW_TINT, 0.78);
  });
  pineMats.forEach((m, i) => {
    m.color.copy(seasonPine[i]);
    if (foliageSnow) m.color.lerp(SNOW_TINT, 0.72);
  });
}

/** Season base palette (spring fresh greens, autumn oranges; summer originals) */
export function applySeasonFoliage(season: Season): void {
  if (season === 'spring' || season === 'autumn') {
    seasonLeaf = SEASON_LEAF[season].map((c) => new THREE.Color(c));
    seasonPine = SEASON_PINE[season].map((c) => new THREE.Color(c));
  } else {
    seasonLeaf = leafColors;
    seasonPine = pineColors;
  }
  paintFoliage();
}

/** Snow cover: dust whatever the current season palette is (and restore it) */
export function applySnowFoliage(on: boolean): void {
  foliageSnow = on;
  paintFoliage();
}
const lampHeadMat = new THREE.MeshStandardMaterial({
  color: '#fff4d6',
  emissive: '#ffe9b0',
  emissiveIntensity: 0,
  roughness: 0.4,
});
registerLamp(lampHeadMat);

let tuftMat: THREE.MeshLambertMaterial | null = null;
function getTuftMat(): THREE.MeshLambertMaterial {
  if (!tuftMat) {
    // lambert, not basic: grass must react to sun/ambient like the ground
    // it grows on — basic made it a constant glowing green in every scene
    tuftMat = new THREE.MeshLambertMaterial({
      map: grassTuftTexture(),
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      color: '#c8e8b0',
    });
  }
  return tuftMat;
}

function tag(g: THREE.Object3D, kind: PlaceableKind, extra?: Partial<{ treeType: TreeType; color: string }>): void {
  g.userData.editable = true;
  g.userData.kind = kind;
  g.userData.record = {
    kind,
    position: [0, 0, 0] as [number, number, number],
    rotationY: 0,
    ...extra,
  };
}

// ============================================================================
// Trees
// ============================================================================

export function createTree(type: TreeType, seed = 1): THREE.Group {
  const g = new THREE.Group();
  const r = makeRng(seed);
  const s = 0.85 + r() * 0.5; // natural size variation

  if (type === 'oak') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.38, 3.4, 7), trunkMat);
    trunk.position.y = 1.7;
    trunk.castShadow = true;
    g.add(trunk);
    const clusters = 4 + Math.floor(r() * 3);
    for (let i = 0; i < clusters; i++) {
      const rad = 1.3 + r() * 1.1;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), leafMats[Math.floor(r() * leafMats.length)]);
      blob.position.set((r() - 0.5) * 2.4, 3.6 + r() * 1.8, (r() - 0.5) * 2.4);
      blob.castShadow = true;
      g.add(blob);
    }
  } else if (type === 'pine') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 2.6, 6), trunkMat);
    trunk.position.y = 1.3;
    trunk.castShadow = true;
    g.add(trunk);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const rad = 2.1 - i * 0.42;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, 1.9, 14), pineMats[i % 2]);
      cone.position.y = 2.6 + i * 1.25;
      cone.castShadow = true;
      g.add(cone);
    }
  } else {
    // birch
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 4.2, 6), birchTrunkMat);
    trunk.position.y = 2.1;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + r() * 0.7, 1), leafMats[3]);
      blob.position.set((r() - 0.5) * 1.6, 4.3 + r() * 1.3, (r() - 0.5) * 1.6);
      blob.castShadow = true;
      g.add(blob);
    }
  }

  g.scale.setScalar(s);
  tag(g, 'tree', { treeType: type });
  return g;
}

// ============================================================================
// Bush / grass / flower
// ============================================================================

export function createBush(seed = 1): THREE.Group {
  const g = new THREE.Group();
  const r = makeRng(seed);
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const rad = 0.45 + r() * 0.4;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), leafMats[Math.floor(r() * leafMats.length)]);
    blob.position.set((r() - 0.5) * 0.9, rad * 0.7, (r() - 0.5) * 0.9);
    blob.castShadow = true;
    g.add(blob);
  }
  tag(g, 'bush');
  return g;
}

export function createGrassTuft(seed = 1): THREE.Group {
  const g = new THREE.Group();
  const r = makeRng(seed);
  const mat = getTuftMat();
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), mat);
    p.position.y = 0.4;
    p.rotation.y = (i * Math.PI) / 2 + r() * 0.5;
    g.add(p);
  }
  g.scale.setScalar(0.8 + r() * 0.6);
  tag(g, 'grass');
  return g;
}

const flowerColors = ['#e05a7a', '#f0c040', '#e8e8f0', '#b06ad9', '#f07840'];
export function createFlower(seed = 1): THREE.Group {
  const g = new THREE.Group();
  const r = makeRng(seed);
  const color = flowerColors[Math.floor(r() * flowerColors.length)];
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.03, 0.5, 5),
    new THREE.MeshStandardMaterial({ color: '#4a7a34', roughness: 1 })
  );
  stem.position.y = 0.25;
  g.add(stem);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 7, 5),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  );
  head.position.y = 0.55;
  head.castShadow = true;
  g.add(head);
  tag(g, 'flower', { color });
  return g;
}

// ============================================================================
// Street furniture
// ============================================================================

export function createBench(): THREE.Group {
  const g = new THREE.Group();
  for (const dx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.5), metalMat);
    leg.position.set(dx, 0.22, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.55), woodMat);
  seat.position.y = 0.48;
  seat.castShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), woodMat);
  back.position.set(0, 0.75, -0.26);
  back.rotation.x = -0.15;
  back.castShadow = true;
  g.add(back);
  tag(g, 'bench');
  return g;
}

export function createStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 5.2, 8), metalMat);
  pole.position.y = 2.6;
  pole.castShadow = true;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), metalMat);
  arm.position.set(0.55, 5.1, 0);
  g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.34), lampHeadMat);
  head.position.set(1.1, 4.98, 0);
  g.add(head);
  tag(g, 'lamp');
  return g;
}

export function createFountain(): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#9a958c', roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.6, 24), stoneMat);
  base.position.y = 0.3;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 2.7, 0.15, 24),
    new THREE.MeshStandardMaterial({
      color: '#4a90c8',
      roughness: 0.08,
      metalness: 0.3,
      transparent: true,
      opacity: 0.85,
      emissive: '#1a4a7a',
      emissiveIntensity: 0.2,
    })
  );
  water.position.y = 0.62;
  g.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 12), stoneMat);
  pillar.position.y = 1.3;
  pillar.castShadow = true;
  g.add(pillar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.7, 0.35, 16), stoneMat);
  bowl.position.y = 2.15;
  bowl.castShadow = true;
  g.add(bowl);
  const droplet = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#7ac8f0', transparent: true, opacity: 0.8, emissive: '#4aa0d0', emissiveIntensity: 0.3 })
  );
  droplet.position.y = 2.55;
  g.add(droplet);

  // spray particles rising from the bowl (animated by CitySystem)
  const N = 60;
  const pos = new Float32Array(N * 3);
  const ang = new Float32Array(N);
  const spd = new Float32Array(N);
  const ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ang[i] = (i / N) * Math.PI * 2 + (i % 3) * 0.7;
    spd[i] = 0.75 + ((i * 37) % 100) / 200;
    ph[i] = ((i * 53) % 100) / 100;
    pos[i * 3] = Math.cos(ang[i]) * 0.3;
    pos[i * 3 + 1] = 2.4;
    pos[i * 3 + 2] = Math.sin(ang[i]) * 0.3;
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const spray = new THREE.Points(
    sprayGeo,
    new THREE.PointsMaterial({
      color: '#cfeaff', size: 0.17, transparent: true, opacity: 0.8, depthWrite: false,
    })
  );
  spray.userData.fountainFX = { ang, spd, ph };
  spray.raycast = () => void 0; // particles must not swallow placement clicks
  g.add(spray);

  tag(g, 'fountain');
  return g;
}

// ============================================================================
// Snowman (snow scene prop)
// ============================================================================

export function createSnowman(): THREE.Group {
  const g = new THREE.Group();
  const snow = new THREE.MeshStandardMaterial({ color: '#f4f8fc', roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.6 });
  const carrot = new THREE.MeshStandardMaterial({ color: '#e87830', roughness: 0.8 });
  const red = new THREE.MeshStandardMaterial({ color: '#c73a34', roughness: 0.8 });

  const base = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 12), snow);
  base.scale.y = 0.85;
  base.position.y = 0.68;
  base.castShadow = true;
  const mid = new THREE.Mesh(new THREE.SphereGeometry(0.56, 14, 12), snow);
  mid.scale.y = 0.9;
  mid.position.y = 1.72;
  mid.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), snow);
  head.position.y = 2.5;
  head.castShadow = true;
  g.add(base, mid, head);

  // eyes + mouth
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), dark);
    eye.position.set(sx * 0.14, 2.6, 0.36);
    g.add(eye);
  }
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), dark);
    b.position.set((i - 1) * 0.11, 2.35 - Math.abs(i - 1) * 0.05, 0.37);
    g.add(b);
  }
  // carrot nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 8), carrot);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 2.52, 0.55);
  g.add(nose);

  // coal buttons
  for (const y of [1.5, 1.74, 1.96]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), dark);
    b.position.set(0, y, 0.52);
    g.add(b);
  }
  // stick arms
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.0, 6), woodMat);
    arm.position.set(sx * 0.86, 1.78, 0);
    arm.rotation.z = sx * 1.15;
    arm.castShadow = true;
    g.add(arm);
  }
  // hat
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 14), dark);
  brim.position.y = 2.84;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.4, 14), dark);
  top.position.y = 3.05;
  top.castShadow = true;
  g.add(brim, top);
  // scarf
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.09, 8, 16), red);
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 2.14;
  g.add(scarf);

  tag(g, 'snowman');
  return g;
}