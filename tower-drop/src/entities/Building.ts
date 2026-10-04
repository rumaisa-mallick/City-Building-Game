import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingParams, PlacedRecord } from '../types';
import { makeFacade, gravelTexture, makeRng } from '../utils/textures';
import { registerFacade, snowCapMaterial } from '../utils/materialRegistry';

const chimneyMat = new THREE.MeshStandardMaterial({ color: '#8a4a3a', roughness: 0.95 });

interface Tier {
  floors: number;
  width: number;
  depth: number;
  base: number;
}

/**
 * Procedural building generator with realistic architecture:
 *  - stepped setbacks on tall towers (real skyline silhouettes)
 *  - plinths, floor bands, entrance frames, classic crowns
 *  - balconies on residential styles, mullion fins on glass towers
 *  - merged detail geometry so all of that costs ~3 draw calls
 * Facade textures are cached per style/floors/size.
 */
export class BuildingFactory {
  private roofMat: THREE.MeshStandardMaterial;
  private concreteMat: THREE.MeshStandardMaterial;
  private metalMat: THREE.MeshStandardMaterial;
  private finMat: THREE.MeshStandardMaterial;
  private darkMat: THREE.MeshStandardMaterial;
  private doorMat: THREE.MeshStandardMaterial;
  private tankMat: THREE.MeshStandardMaterial;
  private awningMats = new Map<string, THREE.MeshStandardMaterial>();
  private facadeCache = new Map<string, [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]>();

  constructor() {
    const gravel = gravelTexture();
    gravel.repeat.set(4, 4);
    this.roofMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, metalness: 0 });
    this.concreteMat = new THREE.MeshStandardMaterial({ color: '#9a978f', roughness: 0.9 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: '#7d838b', roughness: 0.4, metalness: 0.75 });
    this.finMat = new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.28, metalness: 0.88 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.8 });
    this.tankMat = new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 0.9 });
    this.doorMat = new THREE.MeshStandardMaterial({
      color: '#1a2430',
      roughness: 0.12,
      metalness: 0.7,
      emissive: '#8fb6d4',
      emissiveIntensity: 0.15,
    });
  }

  /** Building height in meters */
  height(params: BuildingParams): number {
    return params.floors * 3 + 3;
  }

  /** Tall buildings step back into tiers — the classic skyscraper silhouette */
  private computeTiers(p: BuildingParams): Tier[] {
    const F = p.floors;
    if (F < 9) return [{ floors: F, width: p.width, depth: p.depth, base: 0 }];
    if (F < 16) {
      const f0 = Math.max(4, Math.ceil(F * 0.62));
      const f1 = F - f0;
      return [
        { floors: f0, width: p.width, depth: p.depth, base: 0 },
        { floors: f1, width: Math.max(4, p.width - 4), depth: Math.max(4, p.depth - 4), base: f0 * 3 + 3 },
      ];
    }
    const f0 = Math.max(5, Math.ceil(F * 0.45));
    const f1 = Math.max(4, Math.ceil(F * 0.32));
    const f2 = Math.max(1, F - f0 - f1);
    return [
      { floors: f0, width: p.width, depth: p.depth, base: 0 },
      { floors: f1, width: Math.max(4, p.width - 4), depth: Math.max(4, p.depth - 4), base: f0 * 3 + 3 },
      { floors: f2, width: Math.max(4, p.width - 8), depth: Math.max(4, p.depth - 8), base: (f0 + f1) * 3 + 3 },
    ];
  }

  private tierMats(
    style: BuildingParams['style'],
    floors: number,
    width: number,
    depth: number,
    variant: number,
    entrance: boolean,
    hasGround: boolean
  ): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
    const key = `${style}|${floors}|${width}|${depth}|${variant}|${entrance ? 1 : 0}|${hasGround ? 1 : 0}`;
    const cached = this.facadeCache.get(key);
    if (cached) return cached;

    const mk = (cols: number, isEntrance: boolean): THREE.MeshStandardMaterial => {
      const maps = makeFacade(style, floors, cols, isEntrance, variant, hasGround);
      const m = new THREE.MeshStandardMaterial({
        map: maps.map,
        roughnessMap: maps.rough, // per-texel: glazing polished, masonry matte
        emissiveMap: maps.emissive,
        emissive: '#ffffff',
        emissiveIntensity: 0,
        roughness: 1, // absolute values live in roughnessMap
        metalness: style === 'glass' ? 0.6 : 0.05,
      });
      registerFacade(m);
      return m;
    };

    const colsW = Math.max(2, Math.round(width / 3));
    const colsD = Math.max(2, Math.round(depth / 3));
    const triple: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] = [
      mk(colsW, entrance),
      mk(colsW, false),
      mk(colsD, false),
    ];
    this.facadeCache.set(key, triple);
    return triple;
  }

  create(params: BuildingParams): THREE.Group {
    const g = new THREE.Group();
    const r = makeRng(params.variant * 1013 + params.floors);
    const tiers = this.computeTiers(params);
    const w = params.width;
    const d = params.depth;

    // detail groups, merged into one mesh each at the end
    const stoneGeos: THREE.BufferGeometry[] = []; // plinth, bands, frames, crown
    const railGeos: THREE.BufferGeometry[] = [];  // balcony railings
    const finGeos: THREE.BufferGeometry[] = [];   // glass tower fins
    const capGeos: THREE.BufferGeometry[] = [];   // snow caps (snow scene only)

    let totalH = 0;
    let topW = w;
    let topD = d;

    // ---- stacked tiers ----
    tiers.forEach((t, ti) => {
      const lift = ti * 0.06; // avoids coplanar faces between tiers
      const th = ti === 0 ? t.floors * 3 + 3 : t.floors * 3;
      const [front, back, side] = this.tierMats(
        params.style, t.floors, t.width, t.depth, params.variant, ti === 0, ti === 0
      );
      const geo = new THREE.BoxGeometry(t.width, th, t.depth);
      const bottom = ti === 0 ? this.darkMat : this.roofMat;
      const mesh = new THREE.Mesh(geo, [side, side, this.roofMat, bottom, front, back]);
      mesh.position.set(0, t.base + lift + th / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);

      // parapet / setback deck edge
      const par = new THREE.Mesh(
        new THREE.BoxGeometry(t.width + 0.4, 0.55, t.depth + 0.4),
        this.concreteMat
      );
      par.position.set(0, t.base + lift + th + 0.275, 0);
      par.castShadow = true;
      g.add(par);

      // snow slab on the parapet (sits above the classic crown if there is one)
      const isTop = ti === tiers.length - 1;
      const capY = t.base + lift + th + (isTop && params.style === 'classic' ? 0.7 : 0.55);
      capGeos.push(
        new THREE.BoxGeometry(t.width + 0.3, 0.14, t.depth + 0.3).translate(0, capY + 0.07, 0)
      );

      totalH = t.base + lift + th;
      topW = t.width;
      topD = t.depth;
    });

    // merged snow caps — invisible until the snow scene toggles userData.snowCap
    if (capGeos.length) {
      const mergedCaps = mergeGeometries(capGeos, false);
      capGeos.forEach((gg) => gg.dispose());
      if (mergedCaps) {
        const cap = new THREE.Mesh(mergedCaps, snowCapMaterial);
        cap.castShadow = true;
        cap.receiveShadow = true;
        cap.visible = false;
        g.add(cap);
        g.userData.snowCap = cap;
      }
    }

    // ---- ground plinth (stone base) ----
    stoneGeos.push(new THREE.BoxGeometry(w + 0.5, 0.6, d + 0.5).translate(0, 0.3, 0));

    // ---- band above the ground floor ----
    stoneGeos.push(new THREE.BoxGeometry(w + 0.45, 0.22, d + 0.45).translate(0, 3.11, 0));

    // ---- entrance frame ----
    stoneGeos.push(new THREE.BoxGeometry(0.14, 2.75, 0.26).translate(-0.97, 1.37, d / 2 + 0.05));
    stoneGeos.push(new THREE.BoxGeometry(0.14, 2.75, 0.26).translate(0.97, 1.37, d / 2 + 0.05));
    stoneGeos.push(new THREE.BoxGeometry(2.15, 0.16, 0.26).translate(0, 2.8, d / 2 + 0.05));

    // ---- classic-style crown ----
    if (params.style === 'classic') {
      stoneGeos.push(new THREE.BoxGeometry(w + 0.7, 0.2, d + 0.7).translate(0, totalH + 0.6, 0));
    }

    // ---- balconies (residential styles) ----
    if (['brick', 'classic', 'concrete'].includes(params.style)) {
      const tier0Top = 3 + tiers[0].floors * 3;
      const maxF = Math.min(tiers[0].floors, 12);
      const bw = Math.min(2.6, w * 0.55);
      const bd = 1.0;
      for (let f = 1; f <= maxF; f++) {
        if (params.style === 'concrete' && f % 2 === 1) continue;
        if (params.style === 'classic' && f % 2 === 0) continue;
        const y = 3 + (f - 1) * 3 + 0.1;
        if (y > tier0Top - 2) break;
        let bx = (f % 2 === 0 ? -1 : 1) * Math.min(w / 4, 2.4);
        bx = THREE.MathUtils.clamp(bx, -(w - bw) / 2, Math.max(-(w - bw) / 2, (w - bw) / 2));
        // slab
        stoneGeos.push(new THREE.BoxGeometry(bw, 0.14, bd).translate(bx, y, d / 2 + bd / 2));
        // railings: front + two sides
        railGeos.push(new THREE.BoxGeometry(bw, 0.55, 0.05).translate(bx, y + 0.34, d / 2 + bd - 0.025));
        railGeos.push(new THREE.BoxGeometry(0.05, 0.55, bd).translate(bx - bw / 2 + 0.025, y + 0.34, d / 2 + bd / 2));
        railGeos.push(new THREE.BoxGeometry(0.05, 0.55, bd).translate(bx + bw / 2 - 0.025, y + 0.34, d / 2 + bd / 2));
      }
    }

    // ---- vertical mullion fins on glass towers ----
    if (params.style === 'glass') {
      const h0 = 3 + tiers[0].floors * 3;
      const fh = h0 - 3;
      const fy = 3 + fh / 2;
      for (let x = -w / 2 + 1.5; x <= w / 2 - 1.4; x += 3) {
        finGeos.push(new THREE.BoxGeometry(0.14, fh, 0.36).translate(x, fy, d / 2 + 0.1));
        finGeos.push(new THREE.BoxGeometry(0.14, fh, 0.36).translate(x, fy, -d / 2 - 0.1));
      }
      for (let z = -d / 2 + 1.5; z <= d / 2 - 1.4; z += 3) {
        finGeos.push(new THREE.BoxGeometry(0.36, fh, 0.14).translate(w / 2 + 0.1, fy, z));
        finGeos.push(new THREE.BoxGeometry(0.36, fh, 0.14).translate(-w / 2 - 0.1, fy, z));
      }
    }

    // merge each detail group into a single mesh
    const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material): void => {
      if (geos.length === 0) return;
      const merged = mergeGeometries(geos, false);
      geos.forEach((gg) => gg.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    };
    addMerged(stoneGeos, this.concreteMat);
    addMerged(railGeos, this.metalMat);
    addMerged(finGeos, this.finMat);

    // ---- roof furniture (on the top tier) ----
    const acCount = 1 + Math.floor(r() * 3);
    for (let i = 0; i < acCount; i++) {
      const aw = 1 + r() * 0.8;
      const ac = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.8, 0.9), this.metalMat);
      ac.position.set(
        (r() - 0.5) * Math.max(1, topW - 2),
        totalH + 0.8,
        (r() - 0.5) * Math.max(1, topD - 2)
      );
      ac.castShadow = true;
      g.add(ac);
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10), this.darkMat);
      fan.position.set(ac.position.x, ac.position.y + 0.44, ac.position.z);
      g.add(fan);
    }

    // water tank on taller buildings
    if (params.floors > 5 && r() < 0.45) {
      const tx = (r() > 0.5 ? 1 : -1) * Math.max(0.4, topW / 2 - 1.6);
      const tz = (r() > 0.5 ? 1 : -1) * Math.max(0.4, topD / 2 - 1.6);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 1.6, 10), this.tankMat);
      tank.position.set(tx, totalH + 1.5, tz);
      tank.castShadow = true;
      g.add(tank);
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), this.darkMat);
        leg.position.set(tx + (i < 2 ? -0.7 : 0.7), totalH + 0.5, tz + (i % 2 ? -0.7 : 0.7));
        g.add(leg);
      }
    }

    // chimney — emits procedural smoke particles (CitySystem.rebuildSmoke)
    if (['brick', 'classic', 'warehouse'].includes(params.style) && params.floors >= 3) {
      const cx = (r() - 0.5) * Math.max(1, topW - 2.4);
      const cz = (r() - 0.5) * Math.max(1, topD - 2.4);
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2, 0.7), chimneyMat);
      ch.position.set(cx, totalH + 1, cz);
      ch.castShadow = true;
      g.add(ch);
      g.userData.smoke = [cx, totalH + 2.15, cz] as [number, number, number];
    }

    // antenna
    if (r() < 0.35) {
      const ax = (r() - 0.5) * topW * 0.5;
      const az = (r() - 0.5) * topD * 0.5;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6), this.metalMat);
      ant.position.set(ax, totalH + 1.7, az);
      g.add(ant);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#ff4444', emissive: '#ff2222', emissiveIntensity: 1.4 })
      );
      tip.position.set(ax, totalH + 2.9, az);
      g.add(tip);
    }

    // ---- entrance (front = +z local, on the bottom tier) ----
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.18), this.doorMat);
    door.position.set(0, 1.3, d / 2 + 0.06);
    g.add(door);

    const awningW = Math.min(w * 0.6, 5);
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(awningW, 0.16, 1.4),
      this.awningMat(params.style)
    );
    awning.position.set(0, 3.35, d / 2 + 0.65);
    awning.castShadow = true;
    g.add(awning);

    const steps = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.9), this.concreteMat);
    steps.position.set(0, 0.08, d / 2 + 0.55);
    steps.receiveShadow = true;
    g.add(steps);

    return g;
  }

  private awningMat(style: string): THREE.MeshStandardMaterial {
    let m = this.awningMats.get(style);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: this.awningColor(style), roughness: 0.8 });
      this.awningMats.set(style, m);
    }
    return m;
  }

  private awningColor(style: string): string {
    const map: Record<string, string> = {
      glass: '#3a7ca8',
      brick: '#8a3a2a',
      concrete: '#4a6a4a',
      classic: '#7a5a2a',
      warehouse: '#b8652a',
      neon: '#c42a8a',
    };
    return map[style] || '#555555';
  }

  /** Ghost preview mesh for placement */
  createGhost(params: BuildingParams): THREE.Mesh {
    const h = this.height(params);
    const geo = new THREE.BoxGeometry(params.width, h, params.depth);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.4, depthWrite: false })
    );
    mesh.position.y = h / 2;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: '#ffffff' })
    );
    mesh.add(edges);
    return mesh;
  }
}

/** Attach save metadata to a building group */
export function tagBuilding(g: THREE.Group, params: BuildingParams, lotIndex?: number): void {
  const record: PlacedRecord = {
    kind: 'building',
    position: [0, 0, 0],
    rotationY: 0,
    building: params,
    lotIndex,
  };
  g.userData.editable = true;
  g.userData.record = record;
  g.userData.kind = 'building';
}
