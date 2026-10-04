import * as THREE from 'three';
import {
  GRID, BLOCK, ROAD, SW, TOTAL, ORIGIN, PITCH,
  roadCenter, blockOrigin,
  type Lot, type PlacedRecord, type BuildingParams, type TreeType, type CityStats, type CityBudget, type SceneId,
  type AnimalType, type PlaceableKind, type Season, type WeatherMod, ZONE_COLORS, ZONE_STYLES,
  MAP_ARCHETYPES, type MapArchetype, type MapArchDef, refundOf,
} from '../types';
import { BuildingFactory, tagBuilding } from '../entities/Building';
import {
  createTree, createBush, createGrassTuft, createFlower,
  createBench, createStreetLamp, createFountain, createSnowman, applySnowFoliage,
  applySeasonFoliage,
} from '../entities/Nature';
import { createHospital, createGrocery, createPlayground, createBusStop, createPoliceStation } from '../entities/Facilities';
import { Animal, createAnimal } from '../entities/Animal';
import { Train, RailLoop } from '../entities/Train';
import { Bus } from '../entities/Bus';
import { Wildlife } from '../entities/Wildlife';
import { createConstructionSite, type ConstructionSite } from '../entities/Construction';
import { River, riverBlocksPoint } from '../entities/River';
import { createFireStation, FireEffect, FireTruck } from '../entities/Emergency';
import { SeasonFX } from '../entities/SeasonFX';
import { Person } from '../entities/Person';
import { Car, type CarKind } from '../entities/Vehicle';
import { Cyclist } from '../entities/Bike';
import { buildStreetFurniture, streetKind } from '../entities/Transport';
import { Underground } from '../entities/Underground';
import {
  grassGroundTexture, sidewalkTexture, roadTexture, crosswalkTexture, makeRng,
} from '../utils/textures';
import { registerWettable, setBlackout, gridUnderLoad } from '../utils/materialRegistry';
import { TrafficSystem } from './TrafficSystem';
import { Engine } from '../core/Engine';

/** Per-minute maintenance per placed kind — the cost side of the budget */
export const UPKEEP: Record<string, number> = {
  hospital: 150, firestation: 120, police: 100, grocery: 40, playground: 25,
  train: 60, fountain: 10, busStop: 5, lamp: 2, bench: 1,
};
export const UPKEEP_LABEL: Record<string, string> = {
  hospital: 'Hospital', firestation: 'Fire station', police: 'Police station',
  grocery: 'Grocery', playground: 'Playground', train: 'Train line',
  fountain: 'Fountain', busStop: 'Bus stop', lamp: 'Street lamps', bench: 'Benches',
};

// Air pollution: sources vs green mitigation. The target is derived fresh
// from city state every frame (no RNG — layouts stay byte-identical), then
// smoothed into pollutionVal, which SceneSystem/PostFX paint as smog.
// Measured (seed 777): garden 0.00, grid 0.10, metro 0.41, industrial 0.81.
const POLL = {
  indZone: 0.03,    // one industrial-zoned block
  comZone: 0.01,    // one commercial-zoned block (downtown delivery/AC)
  chimney: 0.002,   // one building with a smoking chimney
  building: 0.0012, // every structure adds a little (density)
  vehicle: 0.004,   // one car / bus / cyclist on the road
  tree: 0.0022,     // one tree absorbs this much
  park: 0.05,       // the park block always scrubs a little
};

// seasonal ground / scenery tints (snow cover overrides them in applyCover)
const SEASON_GROUND: Record<Season, string> = {
  spring: '#fbfff4', summer: '#ffffff', autumn: '#f6e6cc', winter: '#ffffff',
};
const SEASON_HILL: Record<Season, string> = {
  spring: '#4a7c3a', summer: '#3f6b35', autumn: '#75743a', winter: '#3f6b35',
};
const SEASON_FAR: Record<Season, string> = {
  spring: '#35603a', summer: '#2d5228', autumn: '#6a6a2a', winter: '#2d5228',
};

type FacilityKind = 'hospital' | 'grocery' | 'playground' | 'busStop' | 'firestation' | 'police';

const SMOKE_PER = 7; // particles per chimney

/** Soft round sprite for smoke/dust particles */
function softSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Shared smoke material (geometry is per-cloud, material never changes) */
let smokeMat: THREE.PointsMaterial | null = null;
function smokeMaterial(): THREE.PointsMaterial {
  if (!smokeMat) {
    smokeMat = new THREE.PointsMaterial({
      map: softSprite(), color: '#cfd4da', size: 1.7, transparent: true,
      opacity: 0.3, depthWrite: false, sizeAttenuation: true,
    });
  }
  return smokeMat;
}

// ---------------------------------------------------------------------------
// Milestones (meta layer): each pays a one-time reward when its live value
// reaches the target. Claimed ids live on city.goals and round-trip in saves.
// ---------------------------------------------------------------------------
interface GoalDef {
  id: string;
  icon: string;
  label: string;
  reward: number;
  /** live progress value, evaluated against `target` */
  value: (s: CityStats, city: CitySystem) => number;
  target: number;
}

const GOALS: GoalDef[] = [
  { id: 'settle', icon: '🏘️', label: 'Found a settlement', reward: 2000,
    value: (s) => s.buildings, target: 25 },
  { id: 'green50', icon: '🌳', label: 'Plant 50 trees', reward: 1500,
    value: (s) => s.trees, target: 50 },
  { id: 'services', icon: '🏥', label: 'Covered by all essential services', reward: 6000,
    value: (_s, city) => city.essentialServiceCount(), target: 3 },
  { id: 'pop100', icon: '👥', label: 'Welcome 100 citizens', reward: 3000,
    value: (s) => s.people, target: 100 },
  { id: 'money75', icon: '💰', label: 'Treasury of $75,000', reward: 5000,
    value: (s) => s.money, target: 75000 },
  { id: 'income5k', icon: '📈', label: 'Net income of $5,000/min', reward: 8000,
    value: (s) => s.income, target: 5000 },
  { id: 'pop500', icon: '🏙️', label: 'A city of 500 citizens', reward: 15000,
    value: (s) => s.people, target: 500 },
  { id: 'metro', icon: '🌆', label: 'Metropolis — 250 buildings', reward: 25000,
    value: (s) => s.buildings, target: 250 },
];

/**
 * Builds and owns the whole city:
 * roads, sidewalks, crosswalks, scenery hills, lots,
 * default buildings/trees/lamps, walking people and traffic.
 */
export class CitySystem {
  readonly group = new THREE.Group();
  readonly buildingsFactory = new BuildingFactory();
  readonly traffic = new TrafficSystem();

  lots: Lot[] = [];
  people: Person[] = [];
  cars: Car[] = [];
  buses: Bus[] = [];
  cyclists: Cyclist[] = [];
  animals: Animal[] = [];
  trains: Train[] = [];
  zones: number[] = new Array(GRID * GRID).fill(0);
  money = 50000;
  /** Budget tax multiplier: 0.5 – 2.0, in 5% steps (budget panel slider) */
  taxRate = 1;
  /** Milestones claimed — saved (older saves re-derive them on load) */
  goals: string[] = [];
  /** City newspaper feed, newest first — ephemeral (never saved) */
  news: Array<{ day: number; text: string }> = [];
  /** seconds until the next ambient headline */
  private newsIn = 6;
  /** Map layout preset — saved with the city (absent → grid) */
  archetype: MapArchetype = 'grid';
  seed = Math.floor(Math.random() * 1e9);

  private objects: THREE.Object3D[] = [];   // all editable, saveable objects
  private undoStack: THREE.Object3D[] = [];
  private rng = makeRng(this.seed);
  private infraDone = false;
  private rail: RailLoop | null = null;
  private wildlife = new Wildlife();
  private river: River | null = null;

  // per-frame helpers
  private elapsed = 0;
  season: Season = 'summer';
  private seasonFX: SeasonFX | null = null;

  // dynamic weather: live modifier (shared object) + rain puddles on roads
  private weatherMod: WeatherMod | null = null;
  private puddleMat: THREE.MeshStandardMaterial | null = null;
  private puddles: THREE.Mesh[] = [];
  private puddleRings: THREE.Mesh[] = []; // rain-drop ripples on the puddles
  private rippleT: number[] = [];
  private rippleRate: number[] = [];

  // underground cutaway (⛏ / X): the excavation itself + the surface materials
  // that get clip planes while it is open. cutHidden tracks everything we hid
  // inside the prism (statics at open time, movers per frame) so closing the
  // trench only ever restores our own changes.
  private underground: Underground | null = null;
  private cutMats: THREE.Material[] = [];
  private cutHidden = new Set<THREE.Object3D>();
  cutawayOn = false;

  /** Hand CitySystem the live weather modifier (read fresh every frame) */
  attachWeather(mod: WeatherMod): void {
    this.weatherMod = mod;
  }
  // fires: at most one active blaze, answered by the nearest fire station
  private fire: FireEffect | null = null;
  private fireTruck: FireTruck | null = null;
  private fireAge = 0;
  private nextFireIn = 55;
  private moneyTimer = 0;
  // Bulk generate/restore: every register() emits stats, and mid-populate
  // income is transient garbage (buildings land before people/civic upkeep,
  // so property+zones briefly crosses the 5000 milestone). Suppress stats
  // until the final emitStats at the end of the bulk operation.
  private batching = false;
  // pollution → smog: smoothed live value (0..1) + the news band it last sat
  // in. Announced on band crossings only; snapped (never announced) on
  // generate/restore so loading a city doesn't fabricate an air-quality scare.
  private pollutionVal = 0;
  private pollBand = 0;
  private stopsTimer = 0;
  private stopsCache: THREE.Vector3[] = [];

  // city events (ephemeral — never saved): blackout / breakdown / festival
  private blackoutT = 0;        // >0 while the grid is down
  private blackoutFlick = 0;    // seconds of drop-stutter left
  private stallCar: Car | null = null;
  private stallT = 0;
  private festivalT = 0;
  private festival: THREE.Group | null = null;
  private eventTimers = {
    blackout: 55 + Math.random() * 45,
    stall: 75 + Math.random() * 60,
    festival: 120 + Math.random() * 90,
  };

  // chimney smoke
  private smokePoints: THREE.Points | null = null;
  private smokeEmitters: THREE.Vector3[] = [];

  // fountain spray
  private fountainFX: THREE.Points[] = [];

  // zone overlay
  private zoneMeshes: THREE.Mesh[] = [];
  private zoneOverlayOn = false;
  // park cross-paths (rebuilt per generate — the park moves with the archetype)
  private parkPaths: THREE.Mesh[] = [];

  // active construction sites (rising buildings + tower cranes)
  private constructions: Array<{
    g: THREE.Group;
    site: ConstructionSite;
    t: number;
    dur: number;
    startY: number;
    height: number;
  }> = [];

  // snow-scene material handles (set in buildInfrastructure)
  private snowOn = false;
  private sceneId: SceneId = 'day'; // drives vehicle headlights
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private grassTex: THREE.Texture | null = null;
  private hillMat: THREE.MeshStandardMaterial | null = null;
  private farLeafMat: THREE.MeshStandardMaterial | null = null;
  private roadMats: THREE.MeshStandardMaterial[] = [];
  private swMats: THREE.MeshStandardMaterial[] = [];

  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    engine.scene.add(this.group);
    this.group.add(this.traffic.group);
    this.group.add(this.wildlife.group);

    // scene changes drive wildlife activity, snow tinting and ambience
    engine.on('sceneChanged', ({ scene }) => {
      this.sceneId = scene;
      this.wildlife.setScene(scene);
      this.setSnow(scene === 'snow');
    });
  }

  // =====================================================================
  // Generation
  // =====================================================================

  /** Active map-archetype descriptor (falls back to the classic grid) */
  private get archDef(): MapArchDef {
    return MAP_ARCHETYPES.find((a) => a.id === this.archetype) ?? MAP_ARCHETYPES[0];
  }

  /** Block that hosts the city park on this map */
  private get parkBlock(): { i: number; j: number } {
    return this.archDef.park;
  }

  /** World-space centre of the park block */
  private parkCenter(): { x: number; z: number } {
    const pb = this.parkBlock;
    return { x: blockOrigin(pb.i) + BLOCK / 2, z: blockOrigin(pb.j) + BLOCK / 2 };
  }

  generate(newSeed?: number): void {
    if (newSeed !== undefined) this.seed = newSeed;
    this.rng = makeRng(this.seed);

    this.clearAll();
    this.batching = true;
    if (!this.infraDone) {
      this.buildInfrastructure();
      this.infraDone = true;
    }
    this.buildLots();
    this.syncPark();
    const def = this.archDef;
    this.zones = [...def.zones]; // archetype default zoning (New City repaints too)
    this.populateDefaults();
    this.rebuildSmoke();
    this.rebuildStops();
    this.syncZoneMeshes();
    this.batching = false;
    this.snapPollution();
    this.pushNews(`🗺️ ${def.name} map laid out`);
    this.emitStats();
  }

  /**
   * Park cross-paths + wildlife home — rebuilt per generate/restore because
   * the park moves with the archetype. Consumes no rng (grid stays seed-exact).
   */
  private syncPark(): void {
    this.clearParkPaths();
    const c = this.parkCenter();
    const swH = 0.16;
    const mat = this.swMats[1];
    if (mat) {
      const px = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 2 * SW, swH, 3.4), mat);
      px.position.set(c.x, swH / 2, c.z);
      px.receiveShadow = true;
      this.group.add(px);
      this.parkPaths.push(px);
      const pz = new THREE.Mesh(new THREE.BoxGeometry(3.4, swH, BLOCK - 2 * SW), mat);
      pz.position.set(c.x, swH / 2, c.z);
      pz.receiveShadow = true;
      this.group.add(pz);
      this.parkPaths.push(pz);
    }
    this.wildlife.setPark(c.x, c.z);
  }

  private clearParkPaths(): void {
    for (const m of this.parkPaths) {
      this.group.remove(m);
      m.geometry.dispose(); // material is shared with the sidewalk strips
    }
    this.parkPaths = [];
  }

  private clearAll(): void {
    for (const c of this.constructions) c.site.dispose();
    this.constructions = [];
    this.fire?.dispose();
    this.fire = null;
    this.fireTruck?.dispose();
    this.fireTruck = null;
    this.fireAge = 0;
    this.nextFireIn = 55;
    // city events don't survive a fresh generation
    this.removeFestival(false);
    this.blackoutT = 0;
    this.blackoutFlick = 0;
    setBlackout(1);
    this.stallCar?.stall(false);
    this.stallCar = null;
    this.stallT = 0;
    for (const o of this.objects) o.parent?.remove(o);
    this.objects = [];
    this.undoStack = [];
    for (const p of this.people) this.group.remove(p.group);
    for (const c of this.cars) this.group.remove(c.group);
    for (const b of this.buses) this.group.remove(b.group);
    for (const y of this.cyclists) this.group.remove(y.group);
    this.people = [];
    this.cars = [];
    this.buses = [];
    this.cyclists = [];
    this.animals = [];
    this.trains = [];
    this.lots = [];
    this.fountainFX = [];
    this.stopsCache = [];
    this.removeSmoke();
    this.clearParkPaths();
  }

  /** Roads, sidewalks, crosswalks, ground, scenery — built once */
  private buildInfrastructure(): void {
    const r = makeRng(9001);

    // grass ground (huge)
    const grassTex = grassGroundTexture();
    grassTex.repeat.set(140, 140);
    this.grassTex = grassTex;
    // the grass canvas doubles as its own bump map, so the blade speckle gives
    // the ground micro-relief and the sun rakes across it instead of lighting
    // one perfectly flat plane
    this.groundMat = new THREE.MeshStandardMaterial({
      map: grassTex, roughness: 1, metalness: 0,
      bumpMap: grassTex, bumpScale: 0.03,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.group.add(ground);

    // distant hills + treeline for scenery depth.
    // Smooth-shaded: the material carries no flatShading, so the sphere's own
    // indexed normals do the lighting — with the flag on, every one of these read
    // as a faceted dome and the horizon looked built out of cardboard.
    const hillMat = new THREE.MeshStandardMaterial({ color: '#3f6b35', roughness: 1 });
    this.hillMat = hillMat;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + r() * 0.4;
      const dist = 300 + r() * 140;
      const rad = 45 + r() * 55;
      const sy = 0.3 + r() * 0.2;
      const hx = Math.cos(a) * dist;
      const hz = Math.sin(a) * dist;
      if (riverBlocksPoint(hx, hz)) continue; // keep the river trench clear
      const hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 26, 16), hillMat);
      hill.scale.y = sy;
      hill.position.set(hx, 0, hz);
      this.group.add(hill);
    }
    // sunrise ridge: a fixed mountain range due east (az ≈ 88–117°) so the
    // time-lapse dawn lifts the sun straight up from behind the peaks.
    // sits behind the river district's hills (all x > 344, clear of the river).
    const ridge: [number, number, number, number][] = [
      [416, 12, 66, 0.6],
      [410, -30, 74, 0.62],
      [404, -70, 88, 0.66],
      [396, -108, 96, 0.72], // central peak — dead-center behind the rising sun
      [386, -146, 84, 0.64],
      [372, -190, 78, 0.6],
    ];
    for (const [hx, hz, rad, sy] of ridge) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 30, 18), hillMat);
      hill.scale.y = sy;
      hill.position.set(hx, 0, hz);
      hill.userData.ridge = true;
      this.group.add(hill);
    }
    // far tree line (outside the rail loop)
    const farTrunk = new THREE.MeshStandardMaterial({ color: '#4a3828', roughness: 1 });
    const farLeaf = new THREE.MeshStandardMaterial({ color: '#2d5228', roughness: 1 });
    this.farLeafMat = farLeaf;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + r() * 0.12;
      const dist = TOTAL / 2 + 75 + r() * 45;
      const coneRad = 4.5 + r() * 2.5;
      const coneH = 12 + r() * 6;
      const tx = Math.cos(a) * dist;
      const tz = Math.sin(a) * dist;
      if (riverBlocksPoint(tx, tz)) continue; // no trees standing in the water
      const tree = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 7, 5), farTrunk);
      t.position.y = 3.5;
      tree.add(t);
      const c = new THREE.Mesh(new THREE.ConeGeometry(coneRad, coneH, 7), farLeaf);
      c.position.y = 12;
      tree.add(c);
      tree.position.set(tx, 0, tz);
      this.group.add(tree);
    }

    // --- roads (baked flat geometries) ---
    const roadTex = roadTexture();
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex, roughness: 0.85, metalness: 0.08,
      // asphalt aggregate + painted lines pick out a little surface relief
      bumpMap: roadTex, bumpScale: 0.025,
    });

    const hGeo = new THREE.PlaneGeometry(TOTAL, ROAD);
    hGeo.rotateX(-Math.PI / 2);
    const hTex = roadTex.clone(); // independent repeats
    hTex.wrapS = hTex.wrapT = THREE.RepeatWrapping;
    hTex.repeat.set(TOTAL / 10, 1);
    hTex.needsUpdate = true;
    const hMat = roadMat.clone();
    hMat.map = hTex;
    hMat.bumpMap = hTex; // keep relief locked to the same tiling as the colour
    registerWettable(hMat);

    const vGeo = new THREE.PlaneGeometry(TOTAL, ROAD);
    vGeo.rotateX(-Math.PI / 2);
    vGeo.rotateY(Math.PI / 2);
    const vTex = roadTex.clone();
    vTex.wrapS = vTex.wrapT = THREE.RepeatWrapping;
    vTex.repeat.set(TOTAL / 10, 1);
    vTex.needsUpdate = true;
    const vMat = roadMat.clone();
    vMat.map = vTex;
    vMat.bumpMap = vTex;
    registerWettable(vMat);
    this.roadMats = [hMat, vMat];

    for (let k = 0; k <= GRID; k++) {
      const hRoad = new THREE.Mesh(hGeo, hMat);
      hRoad.position.set(0, 0.02, roadCenter(k));
      hRoad.receiveShadow = true;
      this.group.add(hRoad);

      const vRoad = new THREE.Mesh(vGeo, vMat);
      vRoad.position.set(roadCenter(k), 0.02, 0);
      vRoad.receiveShadow = true;
      this.group.add(vRoad);
    }

    // --- rain puddles: glossy pools that fill in the gutters as roads wet
    // out (preset rain scene OR dynamic weather drive them via update()) ---
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: '#3d4a5c', roughness: 0.07, metalness: 0.5,
      transparent: true, opacity: 0, depthWrite: false,
    });
    for (let n = 0; n < 34; n++) {
      const axis = r() < 0.5 ? 'x' : 'z';
      const k = Math.floor(r() * (GRID + 1));
      const center = roadCenter(k);
      const along = (r() * 2 - 1) * (TOTAL / 2 - 16);
      // water pools at the gutter, not the lane center
      const side = (r() < 0.5 ? -1 : 1) * (ROAD / 2 - 1.5 - r() * 1.6);
      const px = axis === 'x' ? along : center + side;
      const pz = axis === 'x' ? center + side : along;
      if (riverBlocksPoint(px, pz)) continue; // no puddles floating on the river
      const p = new THREE.Mesh(new THREE.CircleGeometry(1, 14), this.puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.scale.set(1.3 + r() * 2.2, 0.9 + r() * 1.1, 1); // local XY → world XZ
      p.position.set(px, 0.045, pz);
      p.renderOrder = 2;
      p.visible = false;
      this.group.add(p);
      this.puddles.push(p);

      // ripple ring: a raindrop impact spreading over this puddle
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.68, 18),
        new THREE.MeshBasicMaterial({
          color: '#cfe0ee', transparent: true, opacity: 0,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
      ring.position.z = 0.012; // local +z → up (the puddle is rotated flat)
      ring.scale.setScalar(0.2);
      ring.renderOrder = 3;
      ring.visible = false;
      p.add(ring);
      this.puddleRings.push(ring);
      this.rippleT.push(r());
      this.rippleRate.push(0.7 + r() * 0.9);
    }

    // --- sidewalks per block ---
    const swTex = sidewalkTexture();
    swTex.repeat.set(1, 1);
    const swMat = new THREE.MeshStandardMaterial({
      map: swTex, roughness: 0.95,
      // slab joints read as real kerb relief under raking light
      bumpMap: swTex, bumpScale: 0.05,
    });
    const swMatLong = swMat.clone();
    registerWettable(swMat);
    registerWettable(swMatLong as THREE.MeshStandardMaterial);
    this.swMats = [swMat, swMatLong];
    swMatLong.map = swTex.clone();
    (swMatLong.map as THREE.Texture).wrapS = (swMatLong.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
    (swMatLong.map as THREE.Texture).repeat.set(BLOCK / 2, 1);
    (swMatLong.map as THREE.Texture).needsUpdate = true;
    swMatLong.bumpMap = swMatLong.map;

    const swH = 0.16;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const bx = blockOrigin(i);
        const bz = blockOrigin(j);
        const cx = bx + BLOCK / 2;
        const cz = bz + BLOCK / 2;

        // N/S strips (full block width)
        for (const z of [bz + SW / 2, bz + BLOCK - SW / 2]) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, swH, SW), swMatLong);
          strip.position.set(cx, swH / 2, z);
          strip.receiveShadow = true;
          this.group.add(strip);
        }
        // E/W strips (inset)
        for (const x of [bx + SW / 2, bx + BLOCK - SW / 2]) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(SW, swH, BLOCK - 2 * SW), swMatLong);
          strip.position.set(x, swH / 2, cz);
          strip.receiveShadow = true;
          this.group.add(strip);
        }

        // park cross-paths are built per generate in syncPark() — the park
        // block moves with the archetype
      }
    }

    // --- crosswalks at intersections ---
    const cwTex = crosswalkTexture();
    // standard material (not basic): stripes must be lit — they previously
    // glowed white at night and ignored sun/rain light altogether.
    // registered wettable so they shine like the road in rain.
    const cwMat = new THREE.MeshStandardMaterial({
      map: cwTex, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0.05,
    });
    registerWettable(cwMat);
    const cwGeoA = new THREE.PlaneGeometry(ROAD, 3); // crossing a z-road (stripes along x? drawn across u)
    cwGeoA.rotateX(-Math.PI / 2);
    const cwGeoB = cwGeoA.clone();
    cwGeoB.rotateY(Math.PI / 2);

    for (let kx = 0; kx <= GRID; kx++) {
      for (let kz = 0; kz <= GRID; kz++) {
        const ix = roadCenter(kx);
        const iz = roadCenter(kz);
        const off = ROAD / 2 + 2.2;
        // crossing the north-south road (walking east-west): plane spans x
        for (const dz of [-off, off]) {
          const cw = new THREE.Mesh(cwGeoA, cwMat);
          cw.position.set(ix, 0.05, iz + dz);
          this.group.add(cw);
        }
        for (const dx of [-off, off]) {
          const cw = new THREE.Mesh(cwGeoB, cwMat);
          cw.position.set(ix + dx, 0.05, iz);
          this.group.add(cw);
        }
      }
    }

    // --- railway loop ringing the city (built once with the roads) ---
    this.rail = new RailLoop();
    this.group.add(this.rail.buildMeshes());

    // --- river district east of the rail: canal, girder bridge, promenade ---
    this.river = new River();
    this.group.add(this.river.group);

    // --- street furniture: curb parking, painted bike lanes, taxi stands ---
    const furniture = buildStreetFurniture();
    this.group.add(furniture);

    // --- underground cutaway: dig this street open (X) once built ---
    this.underground = new Underground();
    this.group.add(this.underground.group);
    const cutMats: THREE.Material[] = [...this.roadMats, cwMat];
    if (this.puddleMat) cutMats.push(this.puddleMat);
    if (this.groundMat) cutMats.unshift(this.groundMat);
    for (const ring of this.puddleRings) cutMats.push(ring.material as THREE.Material);
    furniture.traverse((o) => {
      if (o.userData.kind !== 'bikeLane') return; // the only furniture over the road
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m)) cutMats.push(m);
    });
    this.cutMats = cutMats;

    // --- zone overlay planes (one per block, visible while the zone tool is active) ---
    const zoneGeo = new THREE.PlaneGeometry(BLOCK - 1.5, BLOCK - 1.5);
    zoneGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const mesh = new THREE.Mesh(
          zoneGeo,
          new THREE.MeshBasicMaterial({
            color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false,
          })
        );
        mesh.position.set(blockOrigin(i) + BLOCK / 2, 0.2, blockOrigin(j) + BLOCK / 2);
        mesh.visible = false;
        mesh.raycast = () => void 0; // overlay must not swallow clicks
        this.group.add(mesh);
        this.zoneMeshes.push(mesh);
      }
    }
  }

  /** Compute building lots around every non-park block */
  private buildLots(): void {
    this.lots = [];
    let index = 0;
    const r = this.rng;
    const park = this.parkBlock;

    const addRow = (
      horizontal: boolean,
      edgeMin: number,
      fixed: number,
      spanMin: number,
      spanMax: number,
      rotY: number
    ): void => {
      let pos = spanMin;
      while (spanMax - pos >= 7) {
        const w = Math.min([8, 10, 12][Math.floor(r() * 3)], spanMax - pos - 0.5);
        const d = [9, 11, 12][Math.floor(r() * 3)];
        const gap = 0.6;
        if (horizontal) {
          // building sits with depth going inward from `fixed` line
          const inward = rotY === 0 ? 1 : -1; // rot 0 = faces +z (south edge), depth inward -z... handled below
          void inward;
          this.lots.push({
            index: index++,
            cx: pos + w / 2,
            cz: fixed,
            w, d, rotY, occupied: false,
          });
        } else {
          this.lots.push({
            index: index++,
            cx: fixed,
            cz: pos + w / 2,
            w: d, d: w, rotY, occupied: false,
          });
        }
        pos += w + gap;
      }
      void edgeMin;
    };

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        if (i === park.i && j === park.j) continue;

        const bx = blockOrigin(i);
        const bz = blockOrigin(j);
        const zMin = bx === 0 ? 0 : 0; void zMin;
        const zoneMinX = bx + SW;
        const zoneMaxX = bx + BLOCK - SW;
        const zoneMinZ = bz + SW;
        const zoneMaxZ = bz + BLOCK - SW;

        // North edge (low z): faces -z → rotY = PI; depth extends +z (inward)
        // We define lots by center. For N edge: cz = zoneMinZ + d/2
        let pos = zoneMinX;
        while (zoneMaxX - pos >= 7) {
          const w = Math.min([8, 10, 12][Math.floor(this.rng() * 3)], zoneMaxX - pos - 0.5);
          const d = [9, 11, 12][Math.floor(this.rng() * 3)];
          this.lots.push({ index: index++, cx: pos + w / 2, cz: zoneMinZ + d / 2, w, d, rotY: Math.PI, occupied: false });
          pos += w + 0.6;
        }
        // South edge: faces +z → rot 0; depth extends -z
        pos = zoneMinX;
        while (zoneMaxX - pos >= 7) {
          const w = Math.min([8, 10, 12][Math.floor(this.rng() * 3)], zoneMaxX - pos - 0.5);
          const d = [9, 11, 12][Math.floor(this.rng() * 3)];
          this.lots.push({ index: index++, cx: pos + w / 2, cz: zoneMaxZ - d / 2, w, d, rotY: 0, occupied: false });
          pos += w + 0.6;
        }
        // West edge: faces -x → rot -PI/2; inset from corners
        pos = zoneMinZ + SW;
        while (zoneMaxZ - SW - pos >= 7) {
          const w = Math.min([8, 10, 12][Math.floor(this.rng() * 3)], zoneMaxZ - SW - pos - 0.5);
          const d = [9, 11, 12][Math.floor(this.rng() * 3)];
          this.lots.push({ index: index++, cx: zoneMinX + d / 2, cz: pos + w / 2, w, d, rotY: -Math.PI / 2, occupied: false });
          pos += w + 0.6;
        }
        // East edge: faces +x → rot PI/2
        pos = zoneMinZ + SW;
        while (zoneMaxZ - SW - pos >= 7) {
          const w = Math.min([8, 10, 12][Math.floor(this.rng() * 3)], zoneMaxZ - SW - pos - 0.5);
          const d = [9, 11, 12][Math.floor(this.rng() * 3)];
          this.lots.push({ index: index++, cx: zoneMaxX - d / 2, cz: pos + w / 2, w, d, rotY: Math.PI / 2, occupied: false });
          pos += w + 0.6;
        }
      }
    }
    void addRow;
  }

  /** Fill the city with default buildings, nature, people, traffic */
  private populateDefaults(): void {
    const r = this.rng;
    const half = TOTAL / 2;
    const def = this.archDef;
    const park = this.parkBlock;

    // buildings on lots (denser near center, outskirts left open for the player)
    const placed: THREE.Group[] = [];
    for (const lot of this.lots) {
      const distFromCenter = Math.hypot(lot.cx, lot.cz) / half; // 0 center → ~1 edge
      const band = distFromCenter < 0.45 ? 0 : distFromCenter < 0.7 ? 1 : 2;
      const fill = def.fill[band];
      if (r() > fill) continue;

      const zone = this.zoneAtPoint(lot.cx, lot.cz);
      const params = this.randomBuildingParams(distFromCenter, r, zone);
      params.width = lot.w;
      params.depth = lot.d;
      placed.push(this.addBuilding(params, lot.index));
    }

    // a couple of skyline cranes so the city looks like it's still growing
    const candidates = placed.filter((g) => Math.hypot(g.position.x, g.position.z) > 30);
    for (let n = 0; n < 2 && candidates.length > 0; n++) {
      const pick = candidates.splice(Math.floor(r() * candidates.length), 1)[0];
      if (pick) this.beginConstruction(pick, 0.35 + r() * 0.35);
    }

    // civic + shops on free lots: one hospital near the middle, groceries around
    const hlot = this.lots
      .filter((l) => !l.occupied && l.w >= 10 && l.d >= 9)
      .sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz))[0];
    if (hlot) {
      this.addPlaced('hospital', new THREE.Vector3(hlot.cx, 0.16, hlot.cz), hlot.rotY, { lotIndex: hlot.index });
    }
    for (let n = 0; n < 3; n++) {
      const pool = this.lots.filter((l) => !l.occupied && l.w >= 9 && l.d >= 7);
      if (!pool.length) break;
      const pick = pool[Math.floor(r() * pool.length)];
      this.addPlaced('grocery', new THREE.Vector3(pick.cx, 0.16, pick.cz), pick.rotY, { lotIndex: pick.index });
    }

    // fire station out toward the edge — near the blocks it has to cover
    const flot = this.lots
      .filter((l) => !l.occupied && l.w >= 11 && l.d >= 8)
      .sort((a, b) => Math.hypot(b.cx, b.cz) - Math.hypot(a.cx, a.cz))[0];
    if (flot) {
      this.addPlaced('firestation', new THREE.Vector3(flot.cx, 0.16, flot.cz), flot.rotY, { lotIndex: flot.index });
    }

    // police station on the mid-ring — between downtown and the edge station
    const target = half * 0.55;
    const plolot = this.lots
      .filter((l) => !l.occupied && l.w >= 10 && l.d >= 8)
      .sort((a, b) =>
        Math.abs(Math.hypot(a.cx, a.cz) - target) - Math.abs(Math.hypot(b.cx, b.cz) - target))[0];
    if (plolot) {
      this.addPlaced('police', new THREE.Vector3(plolot.cx, 0.16, plolot.cz), plolot.rotY, { lotIndex: plolot.index });
    }

    // street lamps on every block's sidewalks
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const bx = blockOrigin(i);
        const bz = blockOrigin(j);
        const spots = [8, 24, 34];
        for (const t of spots) {
          if (r() < 0.55) {
            this.addPlaced('lamp', new THREE.Vector3(bx + t, 0.16, bz + SW / 2), Math.PI, {});
          }
          if (r() < 0.5) {
            this.addPlaced('lamp', new THREE.Vector3(bx + BLOCK - SW / 2, 0.16, bz + t), -Math.PI / 2, {});
          }
        }
        // street trees
        for (const t of [14, 30]) {
          if (r() < def.treeStreet) {
            const type: TreeType = (['oak', 'pine', 'birch'] as TreeType[])[Math.floor(r() * 3)];
            this.addPlaced('tree', new THREE.Vector3(bx + t, 0.16, bz + BLOCK - SW / 2), r() * Math.PI * 2, { treeType: type });
          }
        }
        // courtyard trees & bushes
        if (!(i === park.i && j === park.j)) {
          for (let n = 0; n < def.treeCourtyard; n++) {
            const type: TreeType = (['oak', 'pine', 'birch'] as TreeType[])[Math.floor(r() * 3)];
            this.addPlaced('tree', new THREE.Vector3(
              bx + SW + 6 + r() * (BLOCK - 2 * SW - 12),
              0,
              bz + SW + 6 + r() * (BLOCK - 2 * SW - 12)
            ), r() * Math.PI * 2, { treeType: type });
          }
          if (r() < 0.7) this.addPlaced('bush', new THREE.Vector3(bx + BLOCK / 2 + (r() - 0.5) * 14, 0, bz + BLOCK / 2 + (r() - 0.5) * 14), 0, {});
        }
      }
    }

    // --- the park ---
    const { x: px, z: pz } = this.parkCenter();
    this.addPlaced('fountain', new THREE.Vector3(px, 0, pz), 0, {});

    for (let n = 0; n < def.treePark; n++) {
      const type: TreeType = (['oak', 'pine', 'birch'] as TreeType[])[Math.floor(r() * 3)];
      const ang = r() * Math.PI * 2;
      const rad = 7 + r() * 10;
      this.addPlaced('tree', new THREE.Vector3(px + Math.cos(ang) * rad, 0, pz + Math.sin(ang) * rad), r() * Math.PI * 2, { treeType: type });
    }
    for (let n = 0; n < 40; n++) {
      const ang = r() * Math.PI * 2;
      const rad = 5 + r() * 13;
      const kind = r() < 0.6 ? 'grass' : 'flower';
      this.addPlaced(kind, new THREE.Vector3(px + Math.cos(ang) * rad, 0, pz + Math.sin(ang) * rad), r() * Math.PI * 2, {});
    }
    for (let n = 0; n < 8; n++) {
      const ang = (n / 8) * Math.PI * 2;
      this.addPlaced('bench', new THREE.Vector3(px + Math.cos(ang) * 6, 0.16, pz + Math.sin(ang) * 6), -ang + Math.PI / 2, {});
    }
    for (let n = 0; n < 4; n++) {
      this.addPlaced('bush', new THREE.Vector3(px + (r() - 0.5) * 24, 0, pz + (r() - 0.5) * 24), 0, {});
    }

    // playground tucked into a park corner + ducks waddling by the fountain
    this.addPlaced('playground', new THREE.Vector3(px - 13, 0, pz + 12), Math.PI / 5, {});
    for (let n = 0; n < 2; n++) {
      const ang = n * Math.PI + 0.8;
      this.addPlaced('duck', new THREE.Vector3(px + Math.cos(ang) * 3.6, 0, pz + Math.sin(ang) * 3.6), r() * Math.PI * 2, {});
    }

    // a train on the loop
    if (this.rail) {
      this.addPlaced('train', new THREE.Vector3(0, 0, 0), 0, { progress: r() * this.rail.length });
    }

    // bus stops around the inner ring road + two buses to serve them
    const c1 = roadCenter(1);
    const c2 = roadCenter(GRID - 1);
    const mid = (c1 + c2) / 2;
    this.addPlaced('busStop', new THREE.Vector3(mid - 8, 0.16, c1 + 7.5), Math.PI, {});
    this.addPlaced('busStop', new THREE.Vector3(mid + 8, 0.16, c2 - 7.5), 0, {});
    this.addPlaced('busStop', new THREE.Vector3(c1 + 7.5, 0.16, mid + 8), -Math.PI / 2, {});
    this.addPlaced('busStop', new THREE.Vector3(c2 - 7.5, 0.16, mid - 8), Math.PI / 2, {});
    this.spawnBuses(2);

    // --- people ---
    this.spawnPeople(def.people);
    // --- traffic ---
    this.spawnCars(def.cars);
    this.spawnCyclists(def.cyclists);
  }

  randomBuildingParams(distFromCenter: number, r: () => number, zone = 0): BuildingParams {
    // downtown: tall glass/concrete; outskirts: low brick/warehouse
    let style: BuildingParams['style'];
    const roll = r();
    if (distFromCenter < 0.5) {
      style = roll < 0.45 ? 'glass' : roll < 0.75 ? 'concrete' : roll < 0.9 ? 'classic' : 'neon';
    } else {
      style = roll < 0.35 ? 'brick' : roll < 0.6 ? 'concrete' : roll < 0.8 ? 'classic' : roll < 0.92 ? 'warehouse' : 'glass';
    }
    // zoning shapes the skyline: pick from the block's zone palette
    const zoneStyles = ZONE_STYLES[zone];
    if (zoneStyles && zoneStyles.length) {
      style = zoneStyles[Math.floor(r() * zoneStyles.length)];
    }
    // height profile per archetype — grid tuning is byte-identical to the classic
    const band = distFromCenter < 0.4 ? 0 : distFromCenter < 0.65 ? 1 : 2;
    const def = this.archDef;
    const floors = Math.max(1, Math.round(def.floorsBase[band] + (r() - 0.4) * def.floorsVar[band]));
    return {
      style,
      floors: Math.min(def.floorsCap, floors),
      width: 10,
      depth: 10,
      variant: Math.floor(r() * 4),
    };
  }

  spawnPeople(count: number): void {
    const r = this.rng;
    for (let n = 0; n < count; n++) {
      const cross = r() < 0.4 ? this.crossWalkPath(r) : null;
      const path = cross ? cross.path : this.randomWalkPath(r);
      const p = new Person(path, Math.floor(r() * 1e6), cross ? cross.gates : undefined);
      this.people.push(p);
      this.group.add(p.group);
    }
  }

  /** Restore saved citizen names after a load (people re-spawn by count only) */
  applyPeopleNames(names: string[]): void {
    for (let i = 0; i < this.people.length && i < names.length; i++) {
      if (names[i]) this.people[i].name = names[i];
    }
  }

  /**
   * A loop between two adjacent blocks that crosses a signalized road twice.
   * Waypoints 1 and 3 are curbs: a gate there holds the walker until the
   * crossing light (the road's red phase) gives walk.
   */
  private crossWalkPath(r: () => number): {
    path: THREE.Vector3[];
    gates: Array<(() => boolean) | null>;
  } | null {
    // signalized intersections only: kx 1..GRID-1, kz 1..GRID-1
    const kx = 1 + Math.floor(r() * (GRID - 1));
    const kz = 2 + Math.floor(r() * (GRID - 2)); // need kz-1 signalized too
    if (kx > GRID - 1 || kz > GRID - 1) return null;

    const i = kx - 1;        // west block
    const j = kz - 1;        // the block whose south & north crossings these are
    if (i > GRID - 2 || j > GRID - 2) return null;

    const xC = roadCenter(kx);
    const y = 0.16;
    const off = ROAD / 2 + 2.2;      // matches the crosswalk decals
    const xW = blockOrigin(i) + BLOCK - SW / 2 - 2;
    const xE = blockOrigin(i + 1) + SW / 2 + 2;
    const zA = roadCenter(kz) - off; // crossing north of block j's top edge
    const zB = roadCenter(kz - 1) + off; // crossing at block j's bottom edge

    const path = [
      new THREE.Vector3(xW, y, zA),
      new THREE.Vector3(xW, y, zB),
      new THREE.Vector3(xE, y, zB),
      new THREE.Vector3(xE, y, zA),
    ];
    // walk the NS road only while it shows red (canGo converts world → k)
    const crossEast = () => !this.traffic.canGo('z', xC, zB);
    const crossWest = () => !this.traffic.canGo('z', xC, zA);
    // gates live on the curb you're standing on when the crossing is NEXT
    return { path, gates: [null, crossEast, null, crossWest] };
  }

  private randomWalkPath(r: () => number): THREE.Vector3[] {
    // loop around a block's sidewalk ring, or wander the park
    if (r() < 0.35) {
      // park figure-eight-ish loop around fountain
      const { x: px, z: pz } = this.parkCenter();
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        pts.push(new THREE.Vector3(px + Math.cos(ang) * 8.5, 0.16, pz + Math.sin(ang) * 8.5));
      }
      return pts;
    }
    const i = Math.floor(r() * GRID);
    const j = Math.floor(r() * GRID);
    const bx = blockOrigin(i);
    const bz = blockOrigin(j);
    const y = 0.16;
    const m = SW / 2;
    return [
      new THREE.Vector3(bx + m + 2, y, bz + m + 2),
      new THREE.Vector3(bx + BLOCK - m - 2, y, bz + m + 2),
      new THREE.Vector3(bx + BLOCK - m - 2, y, bz + BLOCK - m - 2),
      new THREE.Vector3(bx + m + 2, y, bz + BLOCK - m - 2),
    ];
  }

  spawnCars(count: number): void {
    const r = this.rng;
    const half = TOTAL / 2;
    for (let n = 0; n < count; n++) {
      const axis: 'x' | 'z' = r() < 0.5 ? 'x' : 'z';
      const k = Math.floor(r() * (GRID + 1));
      const center = roadCenter(k);
      const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
      // right-hand traffic lanes
      const lane = axis === 'x' ? center + dir * 3 : center - dir * 3;
      const start = (r() * 2 - 1) * half;
      const seed = Math.floor(r() * 1e6);
      // deterministic service fleet — same index rolls on every reload, so
      // save/load round-trips reproduce the exact traffic mix (no save field)
      const kind: CarKind =
        n % 13 === 5 ? 'patrol' :
        n % 10 === 4 ? 'garbage' :
        n % 9 === 7 ? 'mail' :
        n % 7 === 3 ? 'taxi' : 'car';
      const car = new Car(axis, dir, lane, start, seed, kind);
      this.cars.push(car);
      this.group.add(car.group);
    }
  }

  /** Spawn a person that wanders a small loop around where they were placed */
  spawnPersonAt(x: number, z: number): void {
    const y = this.surfaceHeight(x, z);
    const s = 3.5;
    const path = [
      new THREE.Vector3(x - s, y, z - s),
      new THREE.Vector3(x + s, y, z - s),
      new THREE.Vector3(x + s, y, z + s),
      new THREE.Vector3(x - s, y, z + s),
    ];
    const p = new Person(path, Math.floor(Math.random() * 1e6));
    this.people.push(p);
    this.group.add(p.group);
    this.emitStats();
  }

  /** Spawn a car on a lane at a specific position */
  spawnCarAt(axis: 'x' | 'z', dir: 1 | -1, lane: number, start: number): void {
    const car = new Car(axis, dir, lane, start, Math.floor(Math.random() * 1e6));
    this.cars.push(car);
    this.group.add(car.group);
    this.emitStats();
  }

  /** Buses circling the inner ring road (saved as a count-independent pair) */
  spawnBuses(n: number): void {
    for (let i = 0; i < n; i++) {
      const bus = new Bus(this.buses.length + 1); // odd/even seeds spread start legs
      this.buses.push(bus);
      this.group.add(bus.group);
    }
  }

  /** Cyclists ride the painted lanes on bike streets */
  spawnCyclists(count: number): void {
    const r = this.rng;
    const half = TOTAL / 2;
    let made = 0;
    let tries = 0;
    while (made < count && tries < count * 20) {
      tries++;
      const axis: 'x' | 'z' = r() < 0.5 ? 'x' : 'z';
      const k = Math.floor(r() * (GRID + 1));
      if (streetKind(axis, k) !== 'bike') continue;
      const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
      const start = (r() * 2 - 1) * half;
      const c = new Cyclist(axis, dir, roadCenter(k), start, Math.floor(r() * 1e6));
      this.cyclists.push(c);
      this.group.add(c.group);
      made++;
    }
  }

  /** Height of walkable surface at a point */
  private surfaceHeight(x: number, z: number): number {
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const bx = blockOrigin(i);
        const bz = blockOrigin(j);
        if (x >= bx && x <= bx + BLOCK && z >= bz && z <= bz + BLOCK) return 0.16;
      }
    }
    return 0.02;
  }

  /** Ghost factory helpers used by BuildSystem */
  makeTreeForGhost(type: TreeType, seed: number): THREE.Group { return createTree(type, seed); }
  makeBushForGhost(seed: number): THREE.Group { return createBush(seed); }
  makeGrassForGhost(seed: number): THREE.Group { return createGrassTuft(seed); }
  makeFlowerForGhost(seed: number): THREE.Group { return createFlower(seed); }
  makeBenchForGhost(): THREE.Group { return createBench(); }
  makeLampForGhost(): THREE.Group { return createStreetLamp(); }
  makeFountainForGhost(): THREE.Group { return createFountain(); }
  makeSnowmanForGhost(): THREE.Group { return createSnowman(); }
  makeFacilityForGhost(kind: FacilityKind): THREE.Group {
    switch (kind) {
      case 'hospital': return createHospital();
      case 'grocery': return createGrocery();
      case 'busStop': return createBusStop();
      case 'firestation': return createFireStation();
      case 'police': return createPoliceStation();
      default: return createPlayground();
    }
  }
  makeAnimalForGhost(type: AnimalType): THREE.Group { return createAnimal(type, 7); }
  getRail(): RailLoop | null { return this.rail; }

  // =====================================================================
  // Object management (used by BuildSystem)
  // =====================================================================

  addBuilding(params: BuildingParams, lotIndex?: number): THREE.Group {
    const g = this.buildingsFactory.create(params);
    let cx: number, cz: number, rotY: number;

    if (lotIndex !== undefined && this.lots[lotIndex]) {
      const lot = this.lots[lotIndex];
      lot.occupied = true;
      cx = lot.cx;
      cz = lot.cz;
      rotY = lot.rotY;
      // lot depth direction: building depth extends inward already encoded in lot center
      g.position.set(cx, 0.16, cz);
      g.rotation.y = rotY;
      // adjust: lot center was computed assuming depth extends inward; building is centered at lot center ✓
    } else {
      g.position.set(0, 0, 0);
    }

    tagBuilding(g, params, lotIndex);
    const rec = g.userData.record as PlacedRecord;
    rec.position = [g.position.x, g.position.y, g.position.z];
    rec.rotationY = g.rotation.y;
    this.register(g);
    return g;
  }

  /** Place a building at explicit coordinates (free-build outside city) */
  addBuildingAt(params: BuildingParams, x: number, z: number, rotY = 0): THREE.Group {
    const g = this.buildingsFactory.create(params);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    tagBuilding(g, params);
    const rec = g.userData.record as PlacedRecord;
    rec.position = [x, 0, z];
    rec.rotationY = rotY;
    this.register(g);
    return g;
  }

  /**
   * Put a freshly placed building under construction: it starts fully below
   * ground and rises over ~10 game-seconds while a tower crane swings beside
   * it. `progress` pre-advances the clock (used for the seeded skyline cranes).
   */
  beginConstruction(g: THREE.Group, progress = 0): void {
    if (g.userData.constructing || this.constructions.some((c) => c.g === g)) return;
    g.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(g);
    const baseY = g.position.y;
    const height = Math.max(6, box.max.y - baseY);
    const w = Math.max(6, box.max.x - box.min.x);
    const d = Math.max(6, box.max.z - box.min.z);

    const site = createConstructionSite({
      w, d, baseY, height,
      rotY: g.rotation.y, x: g.position.x, z: g.position.z,
    });
    this.group.add(site.group);

    const dur = 10;
    this.constructions.push({
      g, site, dur,
      t: Math.max(0, Math.min(0.95, progress)) * dur,
      startY: baseY,
      height,
    });
    g.userData.constructing = true;
    g.position.y = baseY - (height + 0.5); // fully hidden below ground
    site.update(this.elapsed);
    this.rebuildSmoke(); // chimney must not smoke while buried
  }

  addPlaced(
    kind: PlaceableKind,
    pos: THREE.Vector3,
    rotY: number,
    extra: Partial<Pick<PlacedRecord, 'treeType' | 'color' | 'lotIndex' | 'progress'>>
  ): THREE.Object3D {
    let obj: THREE.Object3D;
    const seed = Math.floor(Math.abs(Math.sin(pos.x * 13.7 + pos.z * 7.3 + this.objects.length)) * 1e6);
    switch (kind) {
      case 'tree': obj = createTree(extra.treeType || 'oak', seed); break;
      case 'bush': obj = createBush(seed); break;
      case 'grass': obj = createGrassTuft(seed); break;
      case 'flower': obj = createFlower(seed); break;
      case 'bench': obj = createBench(); break;
      case 'lamp': obj = createStreetLamp(); break;
      case 'fountain': obj = createFountain(); break;
      case 'hospital': obj = createHospital(); break;
      case 'grocery': obj = createGrocery(); break;
      case 'playground': obj = createPlayground(); break;
      case 'busStop': obj = createBusStop(); break;
      case 'firestation': obj = createFireStation(); break;
      case 'police': obj = createPoliceStation(); break;
      case 'snowman': obj = createSnowman(); break;
      case 'dog': case 'cat': case 'duck': case 'cow': {
        const animal = new Animal(kind, this.wanderPath(pos.x, pos.z, kind), seed);
        obj = animal.group;
        break;
      }
      case 'train': {
        const train = new Train(extra.progress ?? (this.rail ? this.rng() * this.rail.length : 0), seed);
        obj = train.group;
        break;
      }
      default: throw new Error('unsupported kind ' + kind);
    }
    obj.position.copy(pos);
    obj.rotation.y = rotY;
    const rec = obj.userData.record as PlacedRecord;
    if (rec) {
      rec.position = [pos.x, pos.y, pos.z];
      rec.rotationY = rotY;
      if (extra.treeType) rec.treeType = extra.treeType;
      if (extra.lotIndex !== undefined) {
        rec.lotIndex = extra.lotIndex;
        const lot = this.lots[extra.lotIndex];
        if (lot) lot.occupied = true;
      }
      if (extra.progress !== undefined) rec.progress = extra.progress;
    }
    this.register(obj);
    return obj;
  }

  /** Small square wander loop around a placement point, sized per animal */
  private wanderPath(x: number, z: number, kind: AnimalType): THREE.Vector3[] {
    const y = this.surfaceHeight(x, z);
    const s = kind === 'cat' ? 2.5 : kind === 'cow' ? 4 : 3.5;
    return [
      new THREE.Vector3(x - s, y, z - s),
      new THREE.Vector3(x + s, y, z - s),
      new THREE.Vector3(x + s, y, z + s),
      new THREE.Vector3(x - s, y, z + s),
    ];
  }

  private register(obj: THREE.Object3D): void {
    this.group.add(obj);
    this.objects.push(obj);
    // cutaway open: anything registered inside the trench goes invisible
    if (this.cutawayOn && this.underground?.contains(obj.position.x, obj.position.z)) {
      obj.visible = false;
      this.cutHidden.add(obj);
    }
    const animal = obj.userData.animal as Animal | undefined;
    if (animal && !this.animals.includes(animal)) this.animals.push(animal);
    const train = obj.userData.train as Train | undefined;
    if (train && !this.trains.includes(train)) this.trains.push(train);
    // snow scene bookkeeping
    const cap = obj.userData.snowCap as THREE.Mesh | undefined;
    if (cap) cap.visible = this.coverOn;
    const spray = obj.children.find((c) => c.userData.fountainFX) as THREE.Points | undefined;
    if (spray && !this.fountainFX.includes(spray)) this.fountainFX.push(spray);
    if (obj.userData.smoke) this.rebuildSmoke();
    this.undoStack.push(obj);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.emitStats();
  }

  /** Drop an object's actor from the per-frame update lists */
  private pruneActor(obj: THREE.Object3D): void {
    const animal = obj.userData.animal as Animal | undefined;
    if (animal) {
      const i = this.animals.indexOf(animal);
      if (i >= 0) this.animals.splice(i, 1);
    }
    const train = obj.userData.train as Train | undefined;
    if (train) {
      const i = this.trains.indexOf(train);
      if (i >= 0) this.trains.splice(i, 1);
    }
    const person = obj.userData.person as Person | undefined;
    if (person) {
      const i = this.people.indexOf(person);
      if (i >= 0) this.people.splice(i, 1);
    }
    const spray = obj.children.find((c) => c.userData.fountainFX) as THREE.Points | undefined;
    if (spray) {
      const i = this.fountainFX.indexOf(spray);
      if (i >= 0) this.fountainFX.splice(i, 1);
    }
    if (obj.userData.smoke) this.rebuildSmoke();
    // torn down mid-build: take the crane and pad with it
    const ci = this.constructions.findIndex((cc) => cc.g === obj);
    if (ci >= 0) {
      this.constructions[ci].site.dispose();
      this.constructions.splice(ci, 1);
    }
  }

  /** Remove an object (bulldoze) */
  remove(obj: THREE.Object3D): void {
    const rec = obj.userData.record as PlacedRecord | undefined;
    if (rec?.lotIndex !== undefined && this.lots[rec.lotIndex]) {
      this.lots[rec.lotIndex].occupied = false;
    }
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    const u = this.undoStack.indexOf(obj);
    if (u >= 0) this.undoStack.splice(u, 1);
    this.pruneActor(obj);
    obj.parent?.remove(obj);
    this.emitStats();
  }

  undo(): void {
    const last = this.undoStack.pop();
    if (!last) return;
    const rec = last.userData.record as PlacedRecord | undefined;
    if (rec?.lotIndex !== undefined && this.lots[rec.lotIndex]) {
      this.lots[rec.lotIndex].occupied = false;
    }
    const i = this.objects.indexOf(last);
    if (i >= 0) this.objects.splice(i, 1);
    this.pruneActor(last);
    last.parent?.remove(last);
    this.emitStats();
  }

  /** Nearest free lot to a point (within maxDist) */
  nearestFreeLot(x: number, z: number, maxDist = 16): Lot | null {
    let best: Lot | null = null;
    let bestD = maxDist;
    for (const lot of this.lots) {
      if (lot.occupied) continue;
      const d = Math.hypot(lot.cx - x, lot.cz - z);
      if (d < bestD) {
        bestD = d;
        best = lot;
      }
    }
    return best;
  }

  /** Is this point inside any building footprint? */
  insideBuilding(x: number, z: number, pad = 0): boolean {
    for (const o of this.objects) {
      if (o.userData.kind !== 'building') continue;
      const rec = o.userData.record as PlacedRecord;
      const b = rec.building!;
      const rot = Math.abs(rec.rotationY) > 0.1 && Math.abs(Math.abs(rec.rotationY) - Math.PI) > 0.1;
      const w = rot ? b.depth : b.width;
      const d = rot ? b.width : b.depth;
      if (Math.abs(x - o.position.x) < w / 2 + pad && Math.abs(z - o.position.z) < d / 2 + pad) return true;
    }
    return false;
  }

  // =====================================================================
  // Zoning
  // =====================================================================

  /** Block index (j*GRID+i) at a point, or -1 when on a road/outside */
  blockIndexAt(x: number, z: number): number {
    const i = Math.floor((x - ORIGIN - ROAD) / PITCH);
    const j = Math.floor((z - ORIGIN - ROAD) / PITCH);
    if (i < 0 || i >= GRID || j < 0 || j >= GRID) return -1;
    const bx = blockOrigin(i);
    const bz = blockOrigin(j);
    if (x < bx || x > bx + BLOCK || z < bz || z > bz + BLOCK) return -1;
    return j * GRID + i;
  }

  /** Human-readable spot for the selection card: 'the city park', 'Block C-3', 'the high street' */
  placeLabelAt(x: number, z: number): string {
    const idx = this.blockIndexAt(x, z);
    if (idx < 0) return 'the high street';
    const i = idx % GRID;
    const j = Math.floor(idx / GRID);
    const park = this.parkBlock;
    if (i === park.i && j === park.j) return 'the city park';
    return `Block ${String.fromCharCode(65 + i)}-${j + 1}`;
  }

  zoneAt(idx: number): number {
    return this.zones[idx] ?? 0;
  }

  zoneAtPoint(x: number, z: number): number {
    const idx = this.blockIndexAt(x, z);
    return idx < 0 ? 0 : this.zones[idx];
  }

  setZone(idx: number, z: number): void {
    if (idx < 0 || idx >= this.zones.length) return;
    this.zones[idx] = z;
    const mesh = this.zoneMeshes[idx];
    if (mesh) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(ZONE_COLORS[z] || '#ffffff');
      mesh.visible = this.zoneOverlayOn && z > 0;
    }
    this.emitStats();
  }

  showZoneOverlay(on: boolean): void {
    this.zoneOverlayOn = on;
    this.syncZoneMeshes();
  }

  private syncZoneMeshes(): void {
    for (let i = 0; i < this.zoneMeshes.length; i++) {
      const z = this.zones[i] ?? 0;
      (this.zoneMeshes[i].material as THREE.MeshBasicMaterial).color.set(ZONE_COLORS[z] || '#ffffff');
      this.zoneMeshes[i].visible = this.zoneOverlayOn && z > 0;
    }
  }

  // =====================================================================
  // Economy
  // =====================================================================

  spend(n: number): boolean {
    if (n <= 0) return true;
    if (this.money < n) return false;
    this.money -= n;
    this.emitStats();
    return true;
  }

  earn(n: number): void {
    if (n <= 0) return;
    this.money += n;
    this.emitStats();
  }

  // =====================================================================
  // Select & move helpers
  // =====================================================================

  /** Free lot containing (x,z), if any */
  lotAt(x: number, z: number): Lot | null {
    for (const lot of this.lots) {
      if (lot.occupied) continue;
      if (Math.abs(x - lot.cx) <= lot.w / 2 && Math.abs(z - lot.cz) <= lot.d / 2) return lot;
    }
    return null;
  }

  // =====================================================================
  // Seasons & snow cover
  // =====================================================================

  setSeason(s: Season): void {
    if (s === this.season) return;
    this.season = s;
    applySeasonFoliage(s);
    this.applyCover();
    this.updateSeasonFX();
  }

  cycleSeason(): Season {
    const order: Season[] = ['spring', 'summer', 'autumn', 'winter'];
    const next = order[(order.indexOf(this.season) + 1) % order.length];
    this.setSeason(next);
    const names: Record<Season, string> = {
      spring: '🌸 Spring', summer: '☀️ Summer', autumn: '🍁 Autumn', winter: '❄️ Winter',
    };
    this.engine.emit('notice', { message: `${names[next]} settles over the city` });
    return next;
  }

  private updateSeasonFX(): void {
    this.seasonFX?.dispose();
    this.seasonFX = null;
    const mode = this.season === 'spring' ? 'petal' : this.season === 'autumn' ? 'leaf' : null;
    if (mode) {
      this.seasonFX = new SeasonFX(mode);
      this.group.add(this.seasonFX.group);
    }
  }

  /** true while the world should be snow-dusted (snow scene OR winter season) */
  private get coverOn(): boolean {
    return this.snowOn || this.season === 'winter';
  }

  private setSnow(on: boolean): void {
    this.snowOn = on;
    this.applyCover();
  }

  private applyCover(): void {
    const on = this.coverOn;
    applySnowFoliage(on);
    if (!this.infraDone) return;

    if (this.groundMat && this.grassTex) {
      this.groundMat.map = on ? null : this.grassTex;
      this.groundMat.color.set(on ? '#eef3f8' : SEASON_GROUND[this.season]);
      this.groundMat.needsUpdate = true; // swapping the map forces a recompile
    }
    this.hillMat?.color.set(on ? '#e2e9f0' : SEASON_HILL[this.season]);
    this.river?.setSnow(on);
    this.farLeafMat?.color.set(on ? '#e6edf3' : SEASON_FAR[this.season]);
    for (const m of this.roadMats) m.color.set(on ? '#b9c2ca' : '#ffffff');
    for (const m of this.swMats) m.color.set(on ? '#e6ebf1' : '#ffffff');

    for (const o of this.objects) {
      const cap = o.userData.snowCap as THREE.Mesh | undefined;
      if (cap) cap.visible = on;
    }
  }

  // =====================================================================
  // Chimney smoke (rebuilt whenever buildings change)
  // =====================================================================

  private removeSmoke(): void {
    if (this.smokePoints) {
      this.group.remove(this.smokePoints);
      this.smokePoints.geometry.dispose();
      this.smokePoints = null;
    }
    this.smokeEmitters = [];
  }

  private rebuildSmoke(): void {
    this.removeSmoke();
    const emitters: THREE.Vector3[] = [];
    const UP = new THREE.Vector3(0, 1, 0);
    for (const o of this.objects) {
      const s = o.userData.smoke as [number, number, number] | undefined;
      if (!s || o.userData.constructing) continue; // buried chimneys don't smoke
      const v = new THREE.Vector3(s[0], s[1], s[2]);
      if (o.rotation.y !== 0) v.applyAxisAngle(UP, o.rotation.y);
      v.add(o.position);
      emitters.push(v);
    }
    if (!emitters.length) return;
    this.smokeEmitters = emitters;

    const n = emitters.length * SMOKE_PER;
    const pos = new Float32Array(n * 3);
    for (let e = 0; e < emitters.length; e++) {
      for (let k = 0; k < SMOKE_PER; k++) {
        const i = e * SMOKE_PER + k;
        pos[i * 3] = emitters[e].x;
        pos[i * 3 + 1] = emitters[e].y;
        pos[i * 3 + 2] = emitters[e].z;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const smoke = new THREE.Points(geo, smokeMaterial());
    smoke.raycast = () => void 0;
    smoke.frustumCulled = false;
    this.smokePoints = smoke;
    this.group.add(smoke);
  }

  private animateSmoke(): void {
    if (!this.smokePoints) return;
    const attr = this.smokePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let e = 0; e < this.smokeEmitters.length; e++) {
      const em = this.smokeEmitters[e];
      for (let k = 0; k < SMOKE_PER; k++) {
        const i = e * SMOKE_PER + k;
        const phase = k / SMOKE_PER + e * 0.137;
        const t = (this.elapsed * 0.16 + phase) % 1;
        arr[i * 3] = em.x + t * t * 2.6 + Math.sin(t * 5 + k) * 0.3 * t;
        arr[i * 3 + 1] = em.y + t * 6;
        arr[i * 3 + 2] = em.z + t * 1.3;
      }
    }
    attr.needsUpdate = true;
  }

  // =====================================================================
  // Fountain spray animation
  // =====================================================================

  private animateFountains(): void {
    for (const pts of this.fountainFX) {
      const meta = pts.userData.fountainFX as { ang: Float32Array; spd: Float32Array; ph: Float32Array };
      const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < meta.ang.length; i++) {
        const t = (this.elapsed * 0.55 * meta.spd[i] + meta.ph[i]) % 1;
        const r = 0.25 + 1.9 * t;
        arr[i * 3] = Math.cos(meta.ang[i]) * r;
        arr[i * 3 + 1] = 2.35 + 4.8 * t * (1 - t) * (0.7 + 0.3 * meta.spd[i]);
        arr[i * 3 + 2] = Math.sin(meta.ang[i]) * r;
      }
      attr.needsUpdate = true;
    }
  }

  // =====================================================================
  // Bus stops
  // =====================================================================

  private rebuildStops(): void {
    this.stopsCache = this.objects
      .filter((o) => o.userData.kind === 'busStop')
      .map((o) => o.position.clone());
  }

  // =====================================================================
  // Serialization
  // =====================================================================

  serialize(): PlacedRecord[] {
    return this.objects
      .map((o) => o.userData.record as PlacedRecord | undefined)
      .filter((r): r is PlacedRecord => !!r);
  }

  restore(
    records: PlacedRecord[],
    peopleCount: number,
    carsCount: number,
    money?: number,
    zones?: number[],
    bikesCount?: number
  ): void {
    this.clearAll();
    this.batching = true;
    this.rng = makeRng(this.seed);
    if (money !== undefined) this.money = money;
    if (zones && zones.length === this.zones.length) this.zones = zones;
    else this.zones = [...this.archDef.zones]; // legacy save → archetype defaults
    this.buildLots();
    this.syncPark();
    for (const rec of records) {
      const pos = new THREE.Vector3(rec.position[0], rec.position[1], rec.position[2]);
      if (rec.kind === 'building' && rec.building) {
        this.addBuilding(rec.building, rec.lotIndex);
        const g = this.objects[this.objects.length - 1];
        g.position.copy(pos);
        g.rotation.y = rec.rotationY;
        const r2 = g.userData.record as PlacedRecord;
        r2.position = rec.position;
        r2.rotationY = rec.rotationY;
        r2.lotIndex = rec.lotIndex;
      } else {
        this.addPlaced(rec.kind, pos, rec.rotationY, {
          treeType: rec.treeType,
          color: rec.color,
          lotIndex: rec.lotIndex,
          progress: rec.progress,
        });
      }
    }
    this.undoStack = [...this.objects];
    this.spawnPeople(peopleCount);
    this.spawnCars(carsCount);
    this.spawnBuses(2);
    this.spawnCyclists(bikesCount ?? 14);
    this.rebuildSmoke();
    this.rebuildStops();
    this.syncZoneMeshes();
    this.batching = false;
    this.snapPollution();
    this.emitStats();
  }

  // =====================================================================
  // Stats & loop
  // =====================================================================

  /**
   * How many of each kind the player owns — powers the shop's "owned" column
   * and its sell-back list. Read-only: the shop never mutates the grid here.
   */
  kindCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const o of this.objects) {
      const k = o.userData.kind as string;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Resale lines for the shop's Sell tab: one row per owned kind, biggest
   * payback first, with the cash it would return if resold right now.
   */
  refundLines(): Array<{ kind: string; n: number; total: number }> {
    const map = new Map<string, { kind: string; n: number; total: number }>();
    for (const o of this.objects) {
      const rec = o.userData.record as PlacedRecord | undefined;
      if (!rec) continue;
      const e = map.get(rec.kind) ?? { kind: rec.kind, n: 0, total: 0 };
      e.n += 1;
      e.total += refundOf(rec);
      map.set(rec.kind, e);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  /**
   * Full budget: income sources, gross, upkeep lines (biggest first) and the
   * tax-adjusted net. stats().income is simply budget().net, so the top-bar
   * chip, the income tick and the budget panel can never disagree.
   */
  budget(): CityBudget {
    let buildings = 0;
    const counts: Record<string, number> = {};
    for (const o of this.objects) {
      const k = o.userData.kind as string;
      if (k === 'building') buildings++;
      else counts[k] = (counts[k] ?? 0) + 1;
    }
    const zoneCounts = [0, 0, 0, 0];
    for (const z of this.zones) zoneCounts[z] = (zoneCounts[z] ?? 0) + 1;
    const sources = {
      property: buildings * 30,
      residents: this.people.length * 2,
      traffic: (this.cars.length + this.buses.length + this.cyclists.length) * 4,
      zones: zoneCounts[1] * 20 + zoneCounts[2] * 50 + zoneCounts[3] * 40,
    };
    const gross = sources.property + sources.residents + sources.traffic + sources.zones;
    const upkeepLines: Array<{ label: string; amount: number }> = [];
    let upkeep = 0;
    for (const [kind, rate] of Object.entries(UPKEEP)) {
      const n = counts[kind] ?? 0;
      if (n <= 0) continue;
      const amount = n * rate;
      upkeep += amount;
      upkeepLines.push({ label: n > 1 ? `${UPKEEP_LABEL[kind]} ×${n}` : UPKEEP_LABEL[kind], amount });
    }
    upkeepLines.sort((a, b) => b.amount - a.amount);
    const net = Math.round(gross * this.taxRate - upkeep);
    return { sources, gross, upkeepLines, upkeep, taxRate: this.taxRate, net };
  }

  /** Clamp to 0.5–2.0 in 5% steps and re-emit stats so the UI updates live */
  setTaxRate(r: number): number {
    this.taxRate = Math.max(0.5, Math.min(2, Math.round(r * 20) / 20));
    this.emitStats();
    return this.taxRate;
  }

  // =====================================================================
  // Air pollution → smog (drives SceneSystem haze, PostFX veil, HUD AQI)
  // =====================================================================

  /**
   * Instant pollution target derived from the live city state (0..1):
   * industrial zoning + chimneys + traffic, scrubbed by trees, the park
   * block and rainfall. Pure math — no RNG, so grid layouts stay exact.
   */
  get pollutionTarget(): number {
    let ind = 0, com = 0;
    for (const z of this.zones) {
      if (z === 3) ind++;
      else if (z === 2) com++;
    }
    let chimneys = 0, trees = 0, buildings = 0;
    for (const o of this.objects) {
      if (o.userData.kind === 'tree') trees++;
      else if (o.userData.kind === 'building') {
        buildings++;
        if (o.userData.smoke && !o.userData.constructing) chimneys++;
      }
    }
    const raw =
      ind * POLL.indZone +
      com * POLL.comZone +
      chimneys * POLL.chimney +
      buildings * POLL.building +
      (this.cars.length + this.buses.length + this.cyclists.length) * POLL.vehicle -
      trees * POLL.tree -
      POLL.park;
    // rain & storms scrub the air (weather shares this same mod object)
    const rain = this.weatherMod?.rain ?? 0;
    const scrub = 1 - 0.65 * rain;
    return Math.max(0, Math.min(1, raw * scrub));
  }

  /** Smoothed live pollution 0..1 — what the renderer and HUD read */
  get pollution(): number {
    return this.pollutionVal;
  }

  private pollBandOf(v: number): number {
    return v >= 0.58 ? 3 : v >= 0.32 ? 2 : v >= 0.1 ? 1 : 0;
  }

  /** Settle pollution instantly (generate/load): first frame already correct */
  private snapPollution(): void {
    this.pollutionVal = this.pollutionTarget;
    this.pollBand = this.pollBandOf(this.pollutionVal);
  }

  /** Newspaper line when air quality crosses a band (once per crossing) */
  private announcePollution(): void {
    const b = this.pollBandOf(this.pollutionVal);
    if (b === this.pollBand) return;
    const up = b > this.pollBand;
    this.pollBand = b;
    if (up && b === 3) this.pushNews('🏭 Hazardous smog chokes the city — residents urged to stay indoors.');
    else if (up && b === 2) this.pushNews('😷 Smog warning — poor air quality settles over the streets.');
    else if (up && b === 1) this.pushNews('🌫 A smoggy haze drifts in — the skyline fades.');
    else if (!up && b === 0) this.pushNews('🌬️ A clean breeze sweeps through — blue skies return.');
    else if (!up) this.pushNews('💨 The haze is lifting — air quality is improving.');
  }

  stats(): CityStats {
    const s: CityStats = { buildings: 0, trees: 0, people: this.people.length, cars: this.cars.length + this.buses.length + this.cyclists.length, decor: 0, money: this.money, income: 0, pollution: 0 };
    for (const o of this.objects) {
      const k = o.userData.kind;
      if (k === 'building') s.buildings++;
      else if (k === 'tree') s.trees++;
      else s.decor++;
    }
    s.income = this.budget().net;
    s.pollution = this.pollutionVal;
    return s;
  }

  /** How many of the three essential service buildings exist (goals, rating) */
  essentialServiceCount(): number {
    let n = 0;
    for (const kind of ['hospital', 'firestation', 'police']) {
      if (this.objects.some((o) => o.userData.kind === kind)) n++;
    }
    return n;
  }

  /** Claim every newly-passed milestone: pays the reward and toasts it */
  private claimGoals(s: CityStats): boolean {
    let claimed = false;
    for (const g of GOALS) {
      if (this.goals.includes(g.id) || g.value(s, this) < g.target) continue;
      this.goals.push(g.id);
      this.money += g.reward;
      claimed = true;
      this.engine.emit('notice', {
        message: `${g.icon} Milestone: ${g.label}! +$${g.reward.toLocaleString()}`,
      });
      this.pushNews(`${g.icon} Milestone reached: ${g.label}! +$${g.reward.toLocaleString()} for the treasury.`);
    }
    return claimed;
  }

  /** Live milestone progress for the Goals panel */
  goalStatus(): Array<{
    id: string; icon: string; label: string; reward: number;
    value: number; target: number; done: boolean;
  }> {
    const s = this.stats();
    return GOALS.map((g) => ({
      id: g.id,
      icon: g.icon,
      label: g.label,
      reward: g.reward,
      value: Math.max(0, Math.min(g.target, Math.round(g.value(s, this)))),
      target: g.target,
      done: this.goals.includes(g.id),
    }));
  }

  /** One in-game day per simulated minute — drives the HUD clock */
  get day(): number {
    return Math.floor(this.elapsed / 60) + 1;
  }

  emitStats(): void {
    if (this.batching) return; // mid-populate state is transient — the final emit covers it
    // claiming a milestone pays out money, so refresh until the pass-set settles
    let s = this.stats();
    while (this.claimGoals(s)) s = this.stats();
    this.engine.emit('cityUpdated', { stats: s });
  }

  // =====================================================================
  // City newspaper (named citizens + headlines)
  // =====================================================================

  /** Add a headline (newest first) and refresh an open news panel */
  pushNews(text: string): void {
    this.news.unshift({ day: this.day, text });
    if (this.news.length > 30) this.news.pop();
    this.engine.emit('newsUpdated', {});
  }

  /** A random citizen's name for headline copy */
  private pickCitizen(): string {
    if (this.people.length === 0) return 'A resident';
    return this.people[Math.floor(this.rng() * this.people.length)].name;
  }

  /** Ambient headline — always derived from live city state */
  private newsHeadline(): string {
    const s = this.stats();
    const mod = this.weatherMod;
    if (mod && mod.snow > 0.25) return `❄ Snow is falling — ${this.pickCitizen()} wraps up warm.`;
    if (mod && mod.rain > 0.25) return `🌧 Rain sweeping through — ${this.pickCitizen()} dashes for cover.`;
    if (this.pollutionVal >= 0.32) return `😷 Smog hangs over the city — ${this.pickCitizen()} covers up.`;
    const roll = this.rng();
    if (roll < 0.2) return `🌳 The city counts ${s.trees} trees — green and growing.`;
    if (roll < 0.4) return `🚗 ${s.cars} vehicles are out on the roads right now.`;
    if (roll < 0.55) {
      const free = this.lots.filter((l) => !l.occupied).length;
      return `🏗 ${free} empty lots are waiting for builders — ${s.buildings} buildings stand.`;
    }
    if (roll < 0.7) return `💰 The treasury holds $${s.money.toLocaleString()}.`;
    if (roll < 0.85) return `🚶 ${this.pickCitizen()} is out for a walk — the sidewalks are busy.`;
    return `☀ A fine day: ${s.people} residents going about their business.`;
  }

  /**
   * Bumper gap to the nearest vehicle ahead in the same lane (Phase B:
   * car-following). Cars and buses that share a lane form platoons instead of
   * driving through each other; gaps are wrap-aware across the city edge.
   */
  private leadGaps(): Map<Car | Bus, number> {
    const span = TOTAL + 48; // 2 * (half + margin) — matches Car.update's wrap bounds
    interface Mover { ref: Car | Bus; axis: 'x' | 'z'; dir: 1 | -1; t: number; half: number; }
    const buckets = new Map<string, Mover[]>();
    const push = (m: Mover, cross: number): void => {
      const k = `${m.axis}|${m.dir}|${cross.toFixed(2)}`;
      const arr = buckets.get(k);
      if (arr) arr.push(m); else buckets.set(k, [m]);
    };
    for (const c of this.cars) {
      const cross = c.axis === 'x' ? c.group.position.z : c.group.position.x;
      push({ ref: c, axis: c.axis, dir: c.dir,
        t: c.axis === 'x' ? c.group.position.x : c.group.position.z, half: c.halfLen }, cross);
    }
    for (const b of this.buses) {
      const cross = b.axis === 'x' ? b.group.position.z : b.group.position.x;
      push({ ref: b, axis: b.axis, dir: b.dir,
        t: b.axis === 'x' ? b.group.position.x : b.group.position.z, half: 5.2 }, cross);
    }
    const out = new Map<Car | Bus, number>();
    for (const arr of buckets.values()) {
      if (arr.length < 2) continue;
      for (const m of arr) {
        let best = Infinity;
        let leader: Mover | null = null;
        for (const o of arr) {
          if (o === m) continue;
          let g = (o.t - m.t) * m.dir;
          if (g > span / 2) g -= span;
          else if (g <= -span / 2) g += span;
          if (g > 0.01 && g < best) { best = g; leader = o; }
        }
        if (leader) out.set(m.ref, best - m.half - leader.half);
      }
    }
    return out;
  }

  // =====================================================================
  // Underground cutaway (⛏ / X): open a full-depth trench over one street
  // =====================================================================

  /**
   * Open/close the excavation. Opening attaches four local clip planes to
   * every surface material over the road prism (roads, ground, crosswalks,
   * puddles, ripple rings, bike-lane paint) and hides anything standing in
   * it; closing hands the materials back and restores what we hid.
   */
  setCutaway(on: boolean): void {
    if (!this.underground || this.cutawayOn === on) return;
    this.cutawayOn = on;
    const planes = on ? this.underground.planes : null;
    for (const m of this.cutMats) {
      m.clippingPlanes = planes;
      m.clipIntersection = on;
      m.needsUpdate = true;
    }
    this.underground.group.visible = on;
    if (on) {
      for (const o of this.objects) {
        if (o.visible && this.underground.contains(o.position.x, o.position.z)) {
          o.visible = false;
          this.cutHidden.add(o);
        }
      }
    } else {
      for (const o of this.cutHidden) o.visible = true;
      this.cutHidden.clear();
    }
  }

  /**
   * Per-frame while open: tuck movers out of the trench as they enter and
   * hand them back as they leave. Only touches groups we hid ourselves, so
   * it never fights another system's visibility (or a later hide of ours).
   */
  private applyCutRegion(): void {
    const u = this.underground;
    if (!u) return;
    const groups: THREE.Object3D[] = [];
    for (const p of this.people) groups.push(p.group);
    for (const c of this.cars) groups.push(c.group);
    for (const b of this.buses) groups.push(b.group);
    for (const y of this.cyclists) groups.push(y.group);
    for (const a of this.animals) groups.push(a.group);
    if (this.fireTruck) groups.push(this.fireTruck.group);
    for (const g of groups) {
      const inside = u.contains(g.position.x, g.position.z);
      if (inside && g.visible) {
        g.visible = false;
        this.cutHidden.add(g);
      } else if (!inside && this.cutHidden.has(g)) {
        g.visible = true;
        this.cutHidden.delete(g);
      }
    }
  }

  update(dt: number): void {
    const half = TOTAL / 2 + 10;
    this.elapsed += dt;

    // life & details: umbrellas under precipitation, headlights when dark,
    // rings spreading across the wet puddles further down
    const mod = this.weatherMod;
    const roadWet = this.roadMats.length ? (0.85 - this.roadMats[0].roughness) / 0.7 : 0;
    const umbrellaUp =
      roadWet > 0.25 || (mod?.wet ?? 0) > 0.25 || (mod?.rain ?? 0) > 0.1 ||
      (mod?.snow ?? 0) > 0.1 || this.snowOn;
    const lightLvl = this.sceneId === 'night' ? 1 : (mod?.dim ?? 0) > 0.5 ? 0.7 : 0;

    for (const p of this.people) { p.update(dt); p.setUmbrella(umbrellaUp); }
    this.traffic.update(dt);
    const gaps = this.leadGaps();
    for (const c of this.cars) { c.update(dt, half, this.traffic, gaps.get(c)); c.setLights(lightLvl); }
    for (const b of this.buses) { b.update(dt, this.stopsCache, this.traffic, this.elapsed, gaps.get(b)); b.setLights(lightLvl); }
    for (const y of this.cyclists) y.update(dt, half, this.traffic);
    for (const a of this.animals) a.update(dt);
    if (this.rail) {
      for (const t of this.trains) t.update(dt, this.rail);
    }

    // underground cutaway: run the metro shuttle + keep movers out of the hole
    if (this.cutawayOn && this.underground) {
      this.underground.update(dt);
      this.applyCutRegion();
    }

    this.wildlife.update(dt);
    this.river?.update(dt);
    this.seasonFX?.update(dt, this.engine.camera.position.x, this.engine.camera.position.z);
    this.animateFountains();
    this.animateSmoke();

    // pollution → smog: drift toward the live target (rain scrubs it faster)
    const target = this.pollutionTarget;
    this.pollutionVal += (target - this.pollutionVal) * Math.min(1, dt * (0.08 + 0.5 * (mod?.rain ?? 0)));
    this.announcePollution();

    // puddles fill as the roads wet out — dynamic weather (mod.wet) *or*
    // the preset rain scene (applyWetness rewrote the road roughness)
    if (this.puddleMat && this.roadMats.length) {
      const fromWeather = this.weatherMod?.wet ?? 0;
      const fromRoad = (0.85 - this.roadMats[0].roughness) / 0.7;
      const wet = Math.max(0, Math.min(1, Math.max(fromWeather, fromRoad)));
      const on = wet > 0.12;
      this.puddleMat.opacity = on ? Math.min(0.62, (wet - 0.1) * 0.75) : 0;
      const ripple = wet > 0.5; // real rain: drop rings spread across each pool
      for (let i = 0; i < this.puddles.length; i++) {
        const p = this.puddles[i];
        p.visible = on;
        const ring = this.puddleRings[i];
        if (!ring) continue;
        if (!on || !ripple) { ring.visible = false; continue; }
        this.rippleT[i] += dt * this.rippleRate[i];
        if (this.rippleT[i] > 1) this.rippleT[i] -= 1;
        const t = this.rippleT[i];
        const k = 0.2 + t * 0.8;
        ring.scale.set(k, k, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t) * Math.min(1, t * 8);
        ring.visible = true;
      }
    }

    // construction sites: cranes swing, buildings rise out of the ground
    for (let i = this.constructions.length - 1; i >= 0; i--) {
      const c = this.constructions[i];
      c.t += dt;
      c.site.update(this.elapsed);
      const p = Math.min(1, c.t / c.dur);
      const e = 1 - Math.pow(1 - p, 2.4);
      c.g.position.y = c.startY - (c.height + 0.5) * (1 - e);
      if (p >= 1) {
        c.g.position.y = c.startY;
        c.g.userData.constructing = false;
        c.site.dispose();
        this.constructions.splice(i, 1);
        this.rebuildSmoke();
        this.engine.emit('notice', { message: '🏢 Building complete!' });
        this.pushNews(`🏢 A new building is finished — ${this.pickCitizen()} is already eyeing a flat.`);
      }
    }

    // fires: dispatch, spray, extinguish / burn-out
    this.updateFires(dt);
    // random city events: blackout, breakdown, festival
    this.updateEvents(dt);

    // bus-stop positions can change (select tool moves them) — refresh cheaply
    this.stopsTimer += dt;
    if (this.stopsTimer > 0.5) {
      this.stopsTimer = 0;
      this.rebuildStops();
    }

    // passive income tick (every 5s ≈ income/12 per tick → income per minute)
    this.moneyTimer += dt;
    if (this.moneyTimer >= 5) {
      this.moneyTimer -= 5;
      const s = this.stats();
      this.money += Math.round(s.income / 12);
      s.money = this.money;
      this.engine.emit('cityUpdated', { stats: s });
    }

    // newspaper: an ambient headline every ~22–38 s of simulated time
    this.newsIn -= dt;
    if (this.newsIn <= 0) {
      this.newsIn = 22 + this.rng() * 16;
      this.pushNews(this.newsHeadline());
    }
  }

  // =====================================================================
  // Fires: rare random blazes the nearest fire station answers
  // =====================================================================

  /**
   * Random city events — one scheduler per flavour (all ephemeral, never saved):
   *  ⚡ blackout  — the grid fails whenever it's under load (night / storm dark)
   *  🚚 breakdown — a vehicle dies in its lane; traffic queues behind it
   *  🎪 festival — a pop-up street fair appears in the park for a minute
   */
  private updateEvents(dt: number): void {
    // --- blackout ---
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      if (this.blackoutFlick > 0) {
        this.blackoutFlick -= dt;
        // stutter while dropping: full / dead alternating before it settles
        setBlackout(Math.floor(this.elapsed * 14) % 2 === 0 ? 1 : 0.03);
      } else {
        setBlackout(0.03);
      }
      if (this.blackoutT <= 0) {
        setBlackout(1);
        this.engine.emit('notice', { message: '🔌 Power restored — lights come back on.' });
        this.pushNews('🔌 Power restored — the lights come back on across the city.');
      }
    } else {
      // storms hammer the grid: the countdown runs 8× faster while it's dark
      const stormy = (this.weatherMod?.dim ?? 0) >= 0.6;
      this.eventTimers.blackout -= dt * (stormy ? 8 : 1);
      if (this.eventTimers.blackout <= 0) {
        this.eventTimers.blackout = 170 + Math.random() * 150;
        if (gridUnderLoad()) {
          this.blackoutT = 18 + Math.random() * 14;
          this.blackoutFlick = 0.9;
          this.engine.emit('notice', { message: '⚡ Power outage! The streets go dark while crews repair.' });
          this.pushNews('⚡ Power outage — streets go dark while crews work on the grid.');
        }
      }
    }

    // --- breakdown ---
    if (this.stallT > 0) {
      this.stallT -= dt;
      if (this.stallT <= 0) {
        this.stallCar?.stall(false);
        this.stallCar = null;
        this.engine.emit('notice', { message: '🚚 Towed away — traffic moving again.' });
      }
    } else {
      this.eventTimers.stall -= dt;
      if (this.eventTimers.stall <= 0) {
        this.eventTimers.stall = 95 + Math.random() * 90;
        const pool = this.cars.filter((c) => c.kind !== 'patrol');
        if (pool.length > 3) {
          this.stallCar = pool[Math.floor(Math.random() * pool.length)];
          this.stallCar.stall(true);
          this.stallT = 25 + Math.random() * 15;
          this.engine.emit('notice', { message: '🚚 Vehicle broke down — traffic is backing up!' });
        }
      }
    }

    // --- festival ---
    if (this.festivalT > 0) {
      this.festivalT -= dt;
      if (this.festivalT <= 0) this.removeFestival();
    } else {
      this.eventTimers.festival -= dt;
      if (this.eventTimers.festival <= 0) {
        this.eventTimers.festival = 190 + Math.random() * 130;
        this.spawnFestival();
        if (this.festival) this.festivalT = 65 + Math.random() * 25;
      }
    }
  }

  /** Pop-up street fair: 5 tents on clear spots around the park fountain */
  private spawnFestival(): void {
    const colors = ['#e05a5a', '#5a9de0', '#e0c34a', '#5ad98a', '#c46bd9', '#e08a3a'];
    // hard obstacles only: grass/flowers are ground cover (a tent may sit on
    // them), and trains/animals move, so their positions prove nothing
    const SOFT = new Set(['grass', 'flower', 'train', 'duck', 'dog', 'cat', 'cow', 'person']);
    const obstacles = this.objects
      .filter((o) => !SOFT.has(o.userData.kind))
      .map((o) => o.position);
    const g = new THREE.Group();
    const { x: px, z: pz } = this.parkCenter();
    let made = 0;
    for (let a = 0; a < 12 && made < 5; a++) {
      const ang = (a / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
      for (const rad of [10.5, 12.5, 15.5, 18]) {
        const x = px + Math.cos(ang) * rad;
        const z = pz + Math.sin(ang) * rad;
        if (obstacles.some((p) => Math.hypot(p.x - x, p.z - z) < 3.2)) continue;
        g.add(this.makeTent(x, z, colors[made % colors.length]));
        made++;
        break;
      }
    }
    if (made < 4) return; // crowded park — the scheduler retries later
    this.festival = g;
    this.group.add(g);
    this.engine.emit('notice', { message: '🎪 Street festival in the park — food, games and music!' });
    this.pushNews(`🎪 Street festival in the park — ${this.pickCitizen()} can't wait!`);
  }

  private makeTent(x: number, z: number, color: string): THREE.Object3D {
    const t = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.6 });
    for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), poleMat);
      pole.position.set(px, 1.25, pz);
      pole.castShadow = true;
      t.add(pole);
    }
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 1.05, 4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75 })
    );
    canopy.rotation.y = Math.PI / 4;
    canopy.position.y = 3;
    canopy.castShadow = true;
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.85, 1.1),
      new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.9 })
    );
    table.position.y = 0.43;
    table.castShadow = true;
    t.add(canopy, table);
    t.position.set(x, 0, z);
    t.rotation.y = Math.atan2(-x, -z); // face the fountain
    t.userData.festival = true;
    return t;
  }

  private removeFestival(notify = true): void {
    if (!this.festival) return;
    this.festival.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.group.remove(this.festival);
    this.festival = null;
    if (notify) {
      this.engine.emit('notice', { message: '🎪 Festival wrapped up — the park is quiet again.' });
    }
  }

  private updateFires(dt: number): void {
    if (this.fireTruck) {
      this.fireTruck.update(dt);
      if (this.fire && this.fireTruck.spraying) {
        // ~8 seconds of water puts it out
        if (this.fire.douse(1 / 8, dt)) this.endFire(true);
      }
      if (this.fireTruck.state === 'done') {
        this.fireTruck.dispose();
        this.fireTruck = null;
      }
    }
    if (this.fire) {
      this.fire.update(dt);
      this.fireAge += dt;
      // no station on scene: the blaze burns itself out after 45s (with damage)
      if (this.fireAge > (this.fireTruck ? 150 : 45)) this.endFire(false);
    } else {
      this.nextFireIn -= dt;
      if (this.nextFireIn <= 0) {
        this.nextFireIn = 90 + this.rng() * 80;
        if (this.rng() < 0.6) this.startFire();
      }
    }
  }

  private startFire(): void {
    const candidates = this.objects.filter(
      (o) => o.userData.kind === 'building' && !o.userData.constructing
    );
    if (candidates.length < 4) return;
    const b = candidates[Math.floor(this.rng() * candidates.length)];
    const box = new THREE.Box3().setFromObject(b);
    const fx = b.position.x;
    const fz = b.position.z;
    const top = Math.max(box.max.y, b.position.y + 5);
    const w = box.max.x - box.min.x;

    this.fire = new FireEffect(fx, top + 0.1, fz, Math.max(2, Math.min(4, w * 0.22)));
    this.group.add(this.fire.group);
    this.fireAge = 0;
    this.engine.emit('notice', { message: '🔥 Fire breaks out!' });
    this.pushNews('🔥 Fire breaks out — the department races to the scene.');

    const stations = this.objects.filter((o) => o.userData.kind === 'firestation');
    if (stations.length && !this.fireTruck) {
      let best = stations[0];
      let bd = Infinity;
      for (const s of stations) {
        const d = Math.hypot(s.position.x - fx, s.position.z - fz);
        if (d < bd) { bd = d; best = s; }
      }
      const off = new THREE.Vector3(0, 0, 7).applyAxisAngle(
        new THREE.Vector3(0, 1, 0), best.rotation.y
      );
      this.fireTruck = new FireTruck(
        best.position.x + off.x, best.position.z + off.z,
        { x: fx, y: top, z: fz }
      );
      this.group.add(this.fireTruck.group);
      this.engine.emit('notice', { message: '🚒 Firefighters dispatched!' });
    } else if (!stations.length) {
      this.engine.emit('notice', { message: '🏢 No fire station to answer the call…' });
    }
  }

  private endFire(extinguished: boolean): void {
    this.fire?.dispose();
    this.fire = null;
    if (this.fireTruck) this.fireTruck.goHome();
    if (extinguished) {
      this.spend(300);
      this.engine.emit('notice', { message: '✅ Fire extinguished!' });
    } else {
      this.spend(800);
      this.engine.emit('notice', { message: '💥 Fire burned out — damage done!' });
    }
  }

  /** Scene id for saving is handled outside; helper for bounds */
  static get halfSize(): number {
    return TOTAL / 2;
  }
}