import * as THREE from 'three';

// ============================================================================
// Game State & Events
// ============================================================================

export type GameState = 'menu' | 'playing' | 'paused' | 'mapSelect' | 'settings';

export interface CityStats {
  buildings: number;
  trees: number;
  people: number;
  cars: number;
  decor: number;
  money: number;
  income: number; // $ per minute
  pollution: number; // air pollution 0..1 — drives the smog haze & HUD AQI chip
}

/** Income breakdown + service upkeep + tax — what the budget panel shows */
export interface CityBudget {
  sources: { property: number; residents: number; traffic: number; zones: number };
  gross: number;
  upkeepLines: Array<{ label: string; amount: number }>;
  upkeep: number;
  taxRate: number;
  net: number; // $ per minute after upkeep & tax
}

export interface GameEvents {
  gameStateChanged: { state: GameState; previousState: GameState };
  sceneChanged: { scene: SceneId };
  sceneBlended: { a: SceneId; b: SceneId; e: number };
  weatherChanged: { state: WeatherState; mode: WeatherMode };
  cityUpdated: { stats: CityStats };
  selectionChanged: { obj: THREE.Object3D | null };
  notice: { message: string };
  /** Esc with nothing in flight — UI toggles the pause overlay */
  pauseRequested: { source: string };
  /** a newspaper headline was pushed — an open news panel re-renders */
  newsUpdated: Record<string, never>;
  /** a stock ticked / a trade settled — an open exchange panel re-renders */
  marketUpdated: Record<string, never>;
}

// ============================================================================
// Scenes (time of day / weather)
// ============================================================================

export type SceneId = 'morning' | 'day' | 'sunset' | 'night' | 'rain' | 'snow';

// ============================================================================
// Dynamic weather (a modifier layered on top of any time-of-day preset)
// ============================================================================

export type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm';
/** 'auto' rolls the dice over time; the named states hold steady */
export type WeatherMode = 'auto' | WeatherState;

/**
 * Live weather modifier read by SceneSystem/CitySystem every frame.
 * All fields 0..1 unless noted; `flash` is a decaying lightning spike.
 */
export interface WeatherMod {
  clouds: number; // extra sky coverage toward overcast
  gray: number;   // sky/fog gray-down
  dim: number;    // sun & hemisphere dimming
  wet: number;    // road wetness (gloss, puddles)
  rain: number;   // rainfall intensity
  snow: number;   // snowfall intensity (winter's version of rain)
  tilt: number;   // rain slant (wind)
  flash: number;  // lightning flash
}

/** Zone painting (per block): 0 none, 1 residential, 2 commercial, 3 industrial */
export type ZoneType = 0 | 1 | 2 | 3;
export const ZONE_NAMES: string[] = ['None', 'Residential', 'Commercial', 'Industrial'];
export const ZONE_COLORS: string[] = ['transparent', '#4a90d9', '#e8c84a', '#a05ac8'];
/** Zoned blocks steer which building styles appear there */
export const ZONE_STYLES: BuildingStyle[][] = [
  [], ['brick', 'classic'], ['glass', 'neon'], ['warehouse', 'concrete'],
];

// ============================================================================
// Building
// ============================================================================

export type BuildingStyle = 'glass' | 'brick' | 'concrete' | 'classic' | 'warehouse' | 'neon';

export interface BuildingParams {
  style: BuildingStyle;
  floors: number;
  width: number;
  depth: number;
  variant: number;
}

// ============================================================================
// Tools
// ============================================================================

export type ToolId =
  | 'building'
  | 'tree'
  | 'bush'
  | 'grass'
  | 'flower'
  | 'person'
  | 'car'
  | 'bench'
  | 'lamp'
  | 'fountain'
  | 'hospital'
  | 'grocery'
  | 'playground'
  | 'train'
  | 'dog'
  | 'cat'
  | 'duck'
  | 'cow'
  | 'busStop'
  | 'firestation'
  | 'police'
  | 'snowman'
  | 'select'
  | 'zone'
  | 'bulldoze';

export type TreeType = 'oak' | 'pine' | 'birch';
export type AnimalType = 'dog' | 'cat' | 'duck' | 'cow';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

// ============================================================================
// Save data
// ============================================================================

export type PlaceableKind =
  | 'building'
  | 'tree'
  | 'bush'
  | 'grass'
  | 'flower'
  | 'person'
  | 'car'
  | 'bench'
  | 'lamp'
  | 'fountain'
  | 'hospital'
  | 'grocery'
  | 'playground'
  | 'train'
  | 'dog'
  | 'cat'
  | 'duck'
  | 'cow'
  | 'busStop'
  | 'firestation'
  | 'police'
  | 'snowman';

export interface PlacedRecord {
  kind: PlaceableKind;
  position: [number, number, number];
  rotationY: number;
  building?: BuildingParams;
  treeType?: TreeType;
  color?: string;
  lotIndex?: number;
  progress?: number; // trains: distance along the rail loop
}

export interface CitySave {
  version: string;
  scene: SceneId;
  seed: number;
  peopleCount: number;
  carsCount: number;
  bikesCount?: number;
  objects: PlacedRecord[];
  money?: number;
  zones?: number[]; // GRID*GRID zone types
  season?: Season;
  taxRate?: number; // budget: 0.5 – 2.0 (absent on older saves → 1)
  goals?: string[]; // milestones claimed (absent on older saves → re-derived)
  peopleNames?: string[]; // citizen names (absent on older saves → regenerate)
  archetype?: MapArchetype; // map layout (absent on older saves → grid)
  /** stock portfolio (absent on older saves → a fresh $1,000 allowance) */
  stocks?: MarketSave;
}

/** Personal allowance + holdings for the educational stock market */
export interface MarketSave {
  cash: number;
  index?: number;
  indexAvg?: number;
  indexHold?: number;
  shares?: Record<string, { n: number; avg: number; hold?: number }>;
  lessons?: string[];
}

// ============================================================================
// Economy
// ============================================================================

/** Display names for every tool/kind — one source of truth for rail, shop and toasts */
export const TOOL_NAMES: Record<ToolId, string> = {
  building: 'Building', tree: 'Tree', bush: 'Bush', grass: 'Grass', flower: 'Flower',
  person: 'Person', car: 'Car', lamp: 'Lamp', bench: 'Bench', fountain: 'Fountain',
  hospital: 'Hospital', grocery: 'Grocery', playground: 'Playground', train: 'Train',
  dog: 'Dog', cat: 'Cat', duck: 'Duck', cow: 'Cow', busStop: 'Bus Stop',
  firestation: 'Fire Station', police: 'Police Station', snowman: 'Snowman',
  select: 'Select', zone: 'Zone', bulldoze: 'Bulldoze',
};

/** Flat placement costs per tool (buildings are dynamic — see costBuilding) */
export const COSTS: Record<ToolId, number> = {
  building: 0,
  tree: 15,
  bush: 8,
  grass: 3,
  flower: 4,
  person: 10,
  car: 350,
  bench: 25,
  lamp: 60,
  fountain: 500,
  hospital: 8000,
  grocery: 2500,
  playground: 1200,
  train: 15000,
  dog: 80,
  cat: 70,
  duck: 30,
  cow: 200,
  busStop: 150,
  firestation: 3500,
  police: 4000,
  snowman: 40,
  select: 0,
  zone: 250,
  bulldoze: 0,
};

export function costBuilding(p: BuildingParams): number {
  return 150 + p.floors * 40 + p.width * p.depth * 3;
}

/**
 * Resale value of one placed object — 50% of its sticker price, 40% for
 * buildings (they lose more on the way out). One formula, used by bulldoze,
 * the selection card, the shop's resell mode and its "refundable" totals.
 */
export function refundOfKind(kind: string, building?: BuildingParams): number {
  if (building) return Math.round(costBuilding(building) * 0.4);
  return Math.round((COSTS[kind as ToolId] ?? 0) * 0.5);
}

/** Same, straight off a placed record */
export function refundOf(rec?: PlacedRecord): number {
  return rec ? refundOfKind(rec.kind, rec.building) : 0;
}

// ============================================================================
// City layout constants
// ============================================================================

export const GRID = 5;          // blocks per side
export const BLOCK = 40;        // block size (m)
export const ROAD = 12;         // road width (m)
export const PITCH = BLOCK + ROAD; // block + road (m)
export const SW = 3;            // sidewalk width (m)
export const TOTAL = GRID * PITCH + ROAD;
export const ORIGIN = -TOTAL / 2;

export function roadCenter(k: number): number {
  return ORIGIN + k * PITCH + ROAD / 2;
}

export function blockOrigin(i: number): number {
  return ORIGIN + i * PITCH + ROAD;
}

// ============================================================================
// Map archetypes (layout presets chosen from the 🗺 Map panel)
// ============================================================================

export type MapArchetype = 'grid' | 'metro' | 'garden' | 'industrial';

export interface MapArchDef {
  id: MapArchetype;
  icon: string;
  name: string;
  blurb: string;
  /** block (i,j) that hosts the city park */
  park: { i: number; j: number };
  /** default zone painting, index = j*GRID + i (0 none, 1 res, 2 com, 3 ind) */
  zones: number[];
  /** lot fill by distance band (<0.45, <0.7, edge) */
  fill: [number, number, number];
  /** floors = clamp(round(bandsBase[band] + (r()-0.4)*floorsVar[band]), 1, floorsCap) */
  floorsBase: [number, number, number];
  floorsVar: [number, number, number];
  floorsCap: number;
  /** chance a sidewalk spot gets a street tree */
  treeStreet: number;
  /** courtyard trees per block */
  treeCourtyard: number;
  /** trees inside the park */
  treePark: number;
  /** starting population */
  people: number;
  cars: number;
  cyclists: number;
}

/** Paint a GRID×GRID zone array from a per-block rule */
const zoneGrid = (rule: (i: number, j: number) => number): number[] => {
  const out = new Array<number>(GRID * GRID).fill(0);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) out[j * GRID + i] = rule(i, j);
  }
  return out;
};

const centreBlock = Math.floor(GRID / 2);

export const MAP_ARCHETYPES: MapArchDef[] = [
  {
    id: 'grid',
    icon: '🏙️',
    name: 'Classic Grid',
    blurb: 'The original layout — a central park and balanced blocks all round.',
    park: { i: centreBlock, j: centreBlock },
    zones: zoneGrid(() => 0),
    fill: [0.9, 0.68, 0.5],
    floorsBase: [9, 5, 3],
    floorsVar: [12, 5, 5],
    floorsCap: 24,
    treeStreet: 0.5,
    treeCourtyard: 3,
    treePark: 16,
    people: 45,
    cars: 20,
    cyclists: 14,
  },
  {
    id: 'metro',
    icon: '🌆',
    name: 'Metro Core',
    blurb: 'A dense downtown: commercial heart, residential rim, taller towers.',
    park: { i: centreBlock, j: centreBlock },
    // inner 3×3 (park included) commercial, outer ring residential → income 770
    zones: zoneGrid((i, j) =>
      i >= 1 && i <= GRID - 2 && j >= 1 && j <= GRID - 2 ? 2 : 1),
    // rim fill kept below grid's so net income stays under the 5000 milestone
    // threshold (dense downtown + zone income would otherwise claim it on sight)
    fill: [0.95, 0.7, 0.42],
    floorsBase: [15, 9, 6],
    floorsVar: [14, 7, 6],
    floorsCap: 24,
    treeStreet: 0.3,
    treeCourtyard: 1,
    treePark: 12,
    people: 58,
    cars: 30,
    cyclists: 10,
  },
  {
    id: 'garden',
    icon: '🌳',
    name: 'Garden Suburb',
    blurb: 'Low-rise homes, wide lawns and a big park in the north-west corner.',
    park: { i: 0, j: 0 },
    zones: zoneGrid(() => 1), // all residential (park cell included) → income 500
    fill: [0.7, 0.5, 0.35],
    floorsBase: [5, 3, 2],
    floorsVar: [4, 3, 3],
    floorsCap: 8,
    treeStreet: 0.8,
    treeCourtyard: 5,
    treePark: 22,
    people: 36,
    cars: 10,
    cyclists: 18,
  },
  {
    id: 'industrial',
    icon: '🏭',
    name: 'Industrial Quarter',
    blurb: 'Working blocks around the rail ring with a quiet yard park.',
    park: { i: GRID - 1, j: GRID - 1 },
    // perimeter industrial + inner residential (park cell included) → income 820
    zones: zoneGrid((i, j) =>
      i === 0 || i === GRID - 1 || j === 0 || j === GRID - 1 ? 3 : 1),
    fill: [0.78, 0.62, 0.45],
    floorsBase: [6, 4, 3],
    floorsVar: [5, 4, 4],
    floorsCap: 12,
    treeStreet: 0.3,
    treeCourtyard: 1,
    treePark: 8,
    people: 40,
    cars: 22,
    cyclists: 10,
  },
];

export interface Lot {
  index: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  rotY: number; // 0, PI/2, PI, -PI/2
  occupied: boolean;
}

// Utility
export const noop = (_v: unknown): void => void 0;
export type Vec3Tuple = [number, number, number];
export const v3 = (v: THREE.Vector3): Vec3Tuple => [v.x, v.y, v.z];