import * as THREE from 'three';
import type { BuildingStyle } from '../types';

// ============================================================================
// Deterministic RNG
// ============================================================================

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Helpers
// ============================================================================

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  return { c, x };
}

function toTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

function speckle(
  x: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  density: number,
  r: () => number
): void {
  const n = Math.floor(w * h * density);
  for (let i = 0; i < n; i++) {
    x.fillStyle = colors[Math.floor(r() * colors.length)];
    x.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1 + (r() > 0.85 ? 1 : 0), 1);
  }
}

// ============================================================================
// Ground / infrastructure textures (cached)
// ============================================================================

const cache = new Map<string, unknown>();
function cached<T>(key: string, gen: () => T): T {
  if (!cache.has(key)) cache.set(key, gen());
  return cache.get(key) as T;
}

/**
 * Stamp a mark once for every tile position it can straddle.
 *
 * Canvas drawing is clipped at the edge, so a patch centred near x=0 loses its
 * left half and — because the canvas is then tiled 140 times across the ground —
 * that missing half shows up as a straight line on the tile boundary, over and
 * over, laying a visible lattice across the whole landscape. Redrawing the mark
 * one tile across the edge puts the clipped half back where it belongs. The
 * offsets are chosen from the mark's own extent, so the ordinary interior mark
 * still costs a single draw.
 */
function wrapDraw(
  px: number,
  py: number,
  rad: number,
  S: number,
  draw: (ox: number, oy: number) => void
): void {
  const xs = px < rad ? [0, S] : px > S - rad ? [0, -S] : [0];
  const ys = py < rad ? [0, S] : py > S - rad ? [0, -S] : [0];
  for (const dx of xs) for (const dy of ys) draw(px + dx, py + dy);
}

export function grassGroundTexture(): THREE.CanvasTexture {
  return cached('grass', () => {
    const S = 256;
    const { c, x } = makeCanvas(S, S);
    const r = makeRng(1337);
    x.fillStyle = '#4d7a38';
    x.fillRect(0, 0, S, S);
    // patches of varied green — large and low-alpha rather than tight and bright:
    // a small high-contrast blob is a shape you recognise, and a shape you can
    // recognise is a shape you notice repeating every 10 metres. Broad, soft
    // variation reads as uneven ground instead of as a pattern.
    for (let i = 0; i < 60; i++) {
      x.fillStyle = ['#456e30', '#557f3d', '#3e682c', '#5a8a42'][Math.floor(r() * 4)];
      const px = r() * S, py = r() * S, rad = 14 + r() * 40;
      x.globalAlpha = 0.36;
      wrapDraw(px, py, rad, S, (ox, oy) => {
        x.beginPath();
        x.arc(ox, oy, rad, 0, Math.PI * 2);
        x.fill();
      });
    }
    x.globalAlpha = 1;
    // blades
    const blades = ['#5f9245', '#3b6128', '#6ba04e', '#456e30'];
    for (let i = 0; i < 5000; i++) {
      x.fillStyle = blades[Math.floor(r() * 4)];
      const px = Math.floor(r() * S), py = Math.floor(r() * S);
      const bh = 1 + (r() > 0.7 ? 1 : 0);
      wrapDraw(px, py, 1, S, (ox, oy) => x.fillRect(ox, oy, 1, bh));
    }
    return toTexture(c, true);
  });
}

export function sidewalkTexture(): THREE.CanvasTexture {
  return cached('sidewalk', () => {
    const S = 128;
    const { c, x } = makeCanvas(S, S);
    const r = makeRng(4242);
    x.fillStyle = '#a9a69e';
    x.fillRect(0, 0, S, S);
    speckle(x, S, S, ['#b5b2aa', '#9e9b93', '#aaa79f', '#96938b'], 0.25, r);
    // slab joints (2m tiles)
    x.strokeStyle = '#8b887f';
    x.lineWidth = 2;
    x.strokeRect(0, 0, S, S);
    x.beginPath();
    x.moveTo(S / 2, 0); x.lineTo(S / 2, S);
    x.moveTo(0, S / 2); x.lineTo(S, S / 2);
    x.stroke();
    return toTexture(c, true);
  });
}

export function roadTexture(): THREE.CanvasTexture {
  return cached('road', () => {
    const S = 128;
    const { c, x } = makeCanvas(S, S);
    const r = makeRng(777);
    x.fillStyle = '#37373c';
    x.fillRect(0, 0, S, S);
    speckle(x, S, S, ['#3e3e44', '#2e2e33', '#43434a', '#33333a'], 0.35, r);
    // edge lines (v edges = road edges)
    x.fillStyle = '#c9c4b0';
    x.globalAlpha = 0.85;
    x.fillRect(0, 6, S, 4);
    x.fillRect(0, S - 10, S, 4);
    // center dashes (along u = along road)
    x.globalAlpha = 0.9;
    x.fillStyle = '#e8e2cc';
    x.fillRect(0, S / 2 - 3, S * 0.5, 6);
    x.globalAlpha = 1;
    return toTexture(c, true);
  });
}

export function crosswalkTexture(): THREE.CanvasTexture {
  return cached('crosswalk', () => {
    const W = 128, H = 32;
    const { c, x } = makeCanvas(W, H);
    x.clearRect(0, 0, W, H);
    x.fillStyle = '#e8e4d8';
    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      const sw = W / (stripes * 2);
      x.fillRect(i * (W / stripes) + sw * 0.5, 2, sw, H - 4);
    }
    const tex = toTexture(c, false);
    tex.magFilter = THREE.LinearFilter;
    return tex;
  });
}

export function gravelTexture(): THREE.CanvasTexture {
  return cached('gravel', () => {
    const S = 128;
    const { c, x } = makeCanvas(S, S);
    const r = makeRng(99);
    x.fillStyle = '#55555a';
    x.fillRect(0, 0, S, S);
    speckle(x, S, S, ['#5e5e64', '#4a4a50', '#66666c', '#404046'], 0.5, r);
    return toTexture(c, true);
  });
}

/** Geological strata for the cutaway trench walls — topsoil → clay → sand → bedrock */
export function strataTexture(): THREE.CanvasTexture {
  return cached('strata', () => {
    const W = 64, H = 256;
    const { c, x } = makeCanvas(W, H);
    const r = makeRng(31415);
    // H = full wall height (7 m): bands read top → bottom
    const bands: Array<[number, number, string, string]> = [
      // [startFrac, endFrac, fill, speckle]
      [0.0, 0.1, '#4a3626', '#3f2e20'], // topsoil + roots
      [0.1, 0.3, '#6b4b31', '#5d4129'], // clay
      [0.3, 0.52, '#8a6a44', '#7a5d3b'], // sandy loam
      [0.52, 0.7, '#9b8560', '#8b7652'], // sand + gravel
      [0.7, 0.86, '#6f6a5e', '#5f5a50'], // weathered rock
      [0.86, 1.0, '#565a5e', '#4a4e52'], // bedrock
    ];
    for (const [f0, f1, fill, dark] of bands) {
      x.fillStyle = fill;
      x.fillRect(0, f0 * H, W, (f1 - f0) * H + 1);
      // band boundary line
      x.fillStyle = dark;
      x.fillRect(0, f1 * H - 1, W, 2);
      // gravel / pebble flecks inside the band
      const n = Math.floor(((f1 - f0) * H * W) / 90);
      for (let i = 0; i < n; i++) {
        x.fillStyle = r() > 0.5 ? dark : '#a99a80';
        x.fillRect(Math.floor(r() * W), Math.floor(f0 * H + r() * (f1 - f0) * H), 1 + (r() > 0.8 ? 2 : 0), 1);
      }
    }
    // vertical moisture streaks
    x.globalAlpha = 0.18;
    for (let i = 0; i < 5; i++) {
      const px = r() * W;
      x.fillStyle = '#2e2419';
      x.fillRect(px, 0, 1 + r() * 3, H);
    }
    x.globalAlpha = 1;
    return toTexture(c, true);
  });
}

/** Compact trench floor: mud, tyre tracks, scattered gravel */
export function trenchFloorTexture(): THREE.CanvasTexture {
  return cached('trenchFloor', () => {
    const S = 128;
    const { c, x } = makeCanvas(S, S);
    const r = makeRng(2718);
    x.fillStyle = '#6a5943';
    x.fillRect(0, 0, S, S);
    speckle(x, S, S, ['#75634c', '#5d4e3b', '#82705a', '#52452f'], 0.55, r);
    // puddle-dark ruts running along the floor (u = along the trench)
    x.globalAlpha = 0.35;
    for (const ry of [S * 0.3, S * 0.66]) {
      x.fillStyle = '#4a4032';
      x.fillRect(0, ry, S, 7);
      x.fillStyle = '#7d6c53';
      x.fillRect(0, ry + 7, S, 2);
    }
    x.globalAlpha = 1;
    // gravel chips
    for (let i = 0; i < 90; i++) {
      x.fillStyle = ['#8d8578', '#4e463a', '#a19684'][Math.floor(r() * 3)];
      x.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1 + (r() > 0.7 ? 2 : 0), 1);
    }
    return toTexture(c, true);
  });
}

export function grassTuftTexture(): THREE.CanvasTexture {
  return cached('tuft', () => {
    const S = 64;
    const { c, x } = makeCanvas(S, S);
    const r = makeRng(55);
    x.clearRect(0, 0, S, S);
    for (let i = 0; i < 22; i++) {
      const bx = 4 + r() * (S - 8);
      const bh = 20 + r() * 38;
      const lean = (r() - 0.5) * 14;
      x.strokeStyle = ['#5f9245', '#456e30', '#6ba04e', '#3e682c'][Math.floor(r() * 4)];
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(bx, S);
      x.quadraticCurveTo(bx + lean * 0.4, S - bh * 0.6, bx + lean, S - bh);
      x.stroke();
    }
    const tex = toTexture(c, false);
    return tex;
  });
}

// ============================================================================
// Building facades
// ============================================================================

const CELL = 26;   // px per floor
const GROUND = 40; // px ground floor

export interface FacadeMaps {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  /**
   * Per-texel roughness: glazing is polished, masonry is matte.
   * MeshStandardMaterial multiplies `roughness` by this map's green channel,
   * so the material keeps roughness 1 and this canvas carries absolute values.
   */
  rough: THREE.CanvasTexture;
}

interface WinOpts {
  frame: string;
  glassTop: string;
  glassBottom: string;
  curtain: string;
  litColors: string[];
  litChance: number;
}

function drawWindow(
  x2d: CanvasRenderingContext2D,
  e2d: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  r: () => number,
  o: WinOpts
): void {
  // frame
  x2d.fillStyle = o.frame;
  x2d.fillRect(wx, wy, ww, wh);
  // glass
  const g = x2d.createLinearGradient(wx, wy, wx, wy + wh);
  g.addColorStop(0, o.glassTop);
  g.addColorStop(1, o.glassBottom);
  x2d.fillStyle = g;
  x2d.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
  // mullion
  x2d.fillStyle = o.frame;
  if (ww > 16) x2d.fillRect(wx + ww / 2 - 1, wy + 2, 2, wh - 4);
  x2d.fillRect(wx + 2, wy + wh * 0.45, ww - 4, 2);
  // curtain
  if (r() < 0.32) {
    x2d.fillStyle = o.curtain;
    x2d.globalAlpha = 0.85;
    x2d.fillRect(wx + 3, wy + wh * 0.5, ww - 6, wh * 0.5 - 3);
    x2d.globalAlpha = 1;
  }
  // lit → emissive
  if (r() < o.litChance) {
    e2d.fillStyle = o.litColors[Math.floor(r() * o.litColors.length)];
    e2d.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
  } else {
    e2d.fillStyle = '#000000';
    e2d.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
  }
}

function drawGroundFloor(
  x2d: CanvasRenderingContext2D,
  e2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: BuildingStyle,
  r: () => number,
  entrance: boolean
): void {
  const y0 = h - GROUND;
  const signColors: Record<BuildingStyle, string[]> = {
    glass: ['#4aa3d9', '#7ec8e3'],
    brick: ['#c46a3a', '#a8c43f', '#d9a441'],
    concrete: ['#5a8f5a', '#4a7fa8'],
    classic: ['#b8944a', '#8a6d3b'],
    warehouse: ['#d97b29', '#8fa8b8'],
    neon: ['#ff2d95', '#00e5ff', '#ffe14a'],
  };
  const cols = signColors[style];

  if (entrance) {
    // storefront glass
    x2d.fillStyle = '#1c2530';
    x2d.fillRect(0, y0, w, GROUND - 14);
    const g = x2d.createLinearGradient(0, y0, 0, y0 + GROUND - 14);
    g.addColorStop(0, '#8fb6d4');
    g.addColorStop(1, '#3d566e');
    x2d.fillStyle = g;
    x2d.fillRect(4, y0 + 4, w - 8, GROUND - 22);
    // door
    x2d.fillStyle = '#141b24';
    const dw = Math.min(30, w * 0.22);
    x2d.fillRect(w / 2 - dw / 2, y0 + 6, dw, GROUND - 20);
    x2d.fillStyle = '#9fc4dd';
    x2d.fillRect(w / 2 - dw / 2 + 3, y0 + 9, dw - 6, GROUND - 26);
    // sign board
    const sc = cols[Math.floor(r() * cols.length)];
    const sh = 11;
    const sw = Math.min(w - 16, 60 + Math.floor(r() * 40));
    x2d.fillStyle = '#101418';
    x2d.fillRect(w / 2 - sw / 2 - 2, y0 - sh - 2, sw + 4, sh + 4);
    x2d.fillStyle = sc;
    x2d.fillRect(w / 2 - sw / 2, y0 - sh, sw, sh);
    // "letters"
    x2d.fillStyle = '#ffffff';
    const letters = 3 + Math.floor(r() * 4);
    for (let i = 0; i < letters; i++) {
      x2d.fillRect(w / 2 - sw / 2 + 5 + i * ((sw - 10) / letters), y0 - sh + 3, (sw - 10) / letters - 3, sh - 6);
    }
    // emissive: sign glows + warm interior
    e2d.fillStyle = '#000000';
    e2d.fillRect(0, y0, w, GROUND);
    e2d.fillStyle = sc;
    e2d.fillRect(w / 2 - sw / 2, y0 - sh, sw, sh);
    if (r() < 0.75) {
      e2d.fillStyle = 'rgba(255, 214, 150, 0.75)';
      e2d.fillRect(4, y0 + 4, w - 8, GROUND - 22);
    }
  } else {
    // plain back: service door + vents
    x2d.fillStyle = '#232830';
    x2d.fillRect(0, y0, w, GROUND);
    x2d.fillStyle = '#171b21';
    x2d.fillRect(w * 0.3, y0 + 8, 24, GROUND - 12);
    x2d.fillStyle = '#2c323b';
    for (let i = 0; i < 3; i++) x2d.fillRect(w * 0.62, y0 + 10 + i * 8, 20, 4);
    e2d.fillStyle = '#000000';
    e2d.fillRect(0, y0, w, GROUND);
    if (r() < 0.4) {
      e2d.fillStyle = 'rgba(255,220,160,0.5)';
      e2d.fillRect(w * 0.3 + 4, y0 + 12, 16, GROUND - 20);
    }
  }
}

const FACADE_KEYS: Record<BuildingStyle, {
  base: string[];
  win: WinOpts;
  extra?: string;
}> = {
  glass: {
    base: ['#2b3a4a', '#26333f', '#31404f', '#29384a'],
    win: {
      frame: '#141c26',
      glassTop: '#7fa8c9',
      glassBottom: '#33506b',
      curtain: '#5a6f85',
      litColors: ['#cfe6ff', '#e8f4ff', '#b8d8f5'],
      litChance: 0.35,
    },
  },
  brick: {
    base: ['#8a4a3a', '#9c5a44', '#7a4038', '#a06a50'],
    win: {
      frame: '#e8e0d0',
      glassTop: '#bcd9f0',
      glassBottom: '#5f7f9c',
      curtain: '#d9c9a8',
      litColors: ['#ffd9a0', '#ffe8c0', '#f5c878'],
      litChance: 0.42,
    },
  },
  concrete: {
    base: ['#a8a49c', '#9c9890', '#b0aca4', '#98948c'],
    win: {
      frame: '#2a2e34',
      glassTop: '#a8c8e0',
      glassBottom: '#4a6a85',
      curtain: '#c8c0b0',
      litColors: ['#ffe6b0', '#e8f0ff', '#ffd9a0'],
      litChance: 0.4,
    },
  },
  classic: {
    base: ['#c8b89a', '#bfae90', '#c4b498', '#b8a888'],
    win: {
      frame: '#f0e8d8',
      glassTop: '#b0cfe8',
      glassBottom: '#54708c',
      curtain: '#e0d0b0',
      litColors: ['#ffd9a0', '#ffe8c0', '#f0c878'],
      litChance: 0.45,
    },
  },
  warehouse: {
    base: ['#6a6f75', '#5f6469', '#747980', '#64696f'],
    win: {
      frame: '#2e3237',
      glassTop: '#9ab8cc',
      glassBottom: '#3f5a6e',
      curtain: '#7a8288',
      litColors: ['#e8f4ff', '#fff0c0'],
      litChance: 0.3,
    },
  },
  neon: {
    base: ['#1a1a22', '#16161e', '#1e1e28', '#141420'],
    win: {
      frame: '#0a0a10',
      glassTop: '#4a5a7a',
      glassBottom: '#1a2434',
      curtain: '#3a4a5a',
      litColors: ['#00e5ff', '#ff2d95', '#ffe14a', '#7cff6b'],
      litChance: 0.5,
    },
  },
};

export function makeFacade(
  style: BuildingStyle,
  floors: number,
  cols: number,
  entrance: boolean,
  variant: number,
  hasGround = true
): FacadeMaps {
  const key = `${style}|${floors}|${cols}|${entrance ? 1 : 0}|${variant}|${hasGround ? 1 : 0}`;
  return cached('facade:' + key, () => {
    const W = cols * CELL;
    const H = hasGround ? floors * CELL + GROUND : floors * CELL;
    const map = makeCanvas(W, H);
    const emi = makeCanvas(W, H);
    const x2d = map.x;
    const e2d = emi.x;
    const r = makeRng(variant * 7919 + floors * 131 + cols * 17 + style.length * 31);
    const cfg = FACADE_KEYS[style];

    // base
    x2d.fillStyle = cfg.base[Math.floor(r() * cfg.base.length)];
    x2d.fillRect(0, 0, W, H);
    speckle(x2d, W, H, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.05)'], 0.06, r);
    e2d.fillStyle = '#000000';
    e2d.fillRect(0, 0, W, H);

    const top = hasGround ? H - GROUND : H; // top of ground floor = start of upper floors
    // draw floors from ground up
    for (let f = 0; f < floors; f++) {
      const fy = top - (f + 1) * CELL; // floor f sits at y

      if (style === 'brick') {
        // mortar
        x2d.fillStyle = 'rgba(255,255,255,0.10)';
        for (let y = fy; y < fy + CELL; y += 5) x2d.fillRect(0, y, W, 1);
        x2d.fillStyle = 'rgba(0,0,0,0.12)';
        const stag = (f % 2) * 7;
        for (let x = stag; x < W; x += 14) x2d.fillRect(x, fy, 1, 5);
      } else if (style === 'concrete') {
        x2d.fillStyle = 'rgba(0,0,0,0.14)';
        x2d.fillRect(0, fy + CELL - 2, W, 2);
        x2d.fillStyle = 'rgba(255,255,255,0.10)';
        x2d.fillRect(0, fy, W, 1);
        for (let x = 0; x < W; x += CELL) x2d.fillRect(x, fy, 1, CELL);
      } else if (style === 'classic') {
        x2d.fillStyle = 'rgba(0,0,0,0.16)';
        x2d.fillRect(0, fy + CELL - 3, W, 3);
        x2d.fillStyle = 'rgba(255,255,255,0.20)';
        x2d.fillRect(0, fy + CELL - 5, W, 2);
      } else if (style === 'warehouse') {
        x2d.fillStyle = 'rgba(0,0,0,0.15)';
        for (let x = 0; x < W; x += 9) x2d.fillRect(x, fy, 2, CELL);
      } else if (style === 'neon') {
        // neon strip per floor
        const neonCols = ['#ff2d95', '#00e5ff', '#ffe14a', '#7cff6b'];
        const nc = neonCols[f % neonCols.length];
        x2d.fillStyle = nc;
        x2d.fillRect(0, fy, W, 3);
        e2d.fillStyle = nc;
        e2d.fillRect(0, fy, W, 3);
      } else if (style === 'glass') {
        x2d.fillStyle = '#1b2530';
        x2d.fillRect(0, fy + CELL - 4, W, 4);
      }

      // windows per cell
      const showWindows = style === 'warehouse' ? f % 2 === 0 || f === floors - 1 : true;
      if (showWindows) {
        for (let c = 0; c < cols; c++) {
          const cx0 = c * CELL;
          if (style === 'glass') {
            // full curtain-wall panel
            const wx = cx0 + 1, wy = fy + 3, ww = CELL - 2, wh = CELL - 9;
            x2d.fillStyle = cfg.win.frame;
            x2d.fillRect(wx, wy, ww, wh);
            const g = x2d.createLinearGradient(wx, wy, wx, wy + wh);
            g.addColorStop(0, cfg.win.glassTop);
            g.addColorStop(1, cfg.win.glassBottom);
            x2d.fillStyle = g;
            x2d.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
            if (r() < cfg.win.litChance) {
              e2d.fillStyle = cfg.win.litColors[Math.floor(r() * cfg.win.litColors.length)];
              e2d.globalAlpha = 0.8;
              e2d.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
              e2d.globalAlpha = 1;
            }
          } else if (style === 'warehouse') {
            if (r() < 0.8) {
              drawWindow(x2d, e2d, cx0 + 5, fy + 6, CELL - 10, 11, r, cfg.win);
            }
          } else if (style === 'classic') {
            // arched window
            const wx = cx0 + 5, wy = fy + 5, ww = CELL - 10, wh = CELL - 10;
            x2d.fillStyle = cfg.win.frame;
            x2d.beginPath();
            x2d.moveTo(wx, wy + wh);
            x2d.lineTo(wx, wy + ww / 2);
            x2d.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0);
            x2d.lineTo(wx + ww, wy + wh);
            x2d.closePath();
            x2d.fill();
            drawWindow(x2d, e2d, wx, wy + 4, ww, wh - 4, r, cfg.win);
          } else {
            drawWindow(x2d, e2d, cx0 + 4, fy + 4, CELL - 8, CELL - 9, r, cfg.win);
          }
        }
      }
    }

    if (hasGround) {
      drawGroundFloor(x2d, e2d, W, H, style, r, entrance);
    }

    // --- weathering & realism pass ---
    // dark runoff streaks (rain dirt under sills)
    x2d.strokeStyle = 'rgba(24, 20, 14, 0.09)';
    for (let i = 0; i < Math.floor(W * 0.8); i++) {
      const sx = Math.floor(r() * W);
      const sy = Math.floor(r() * Math.max(1, top));
      const ey = Math.min(top, sy + 8 + r() * 30);
      x2d.lineWidth = 1 + r() * 1.5;
      x2d.beginPath();
      x2d.moveTo(sx, sy);
      x2d.lineTo(sx + (r() - 0.5) * 2, ey);
      x2d.stroke();
    }
    // large soft dirt patches
    for (let i = 0; i < 6; i++) {
      const px = r() * W;
      const py = r() * Math.max(1, top);
      const rad = 20 + r() * 50;
      const rg = x2d.createRadialGradient(px, py, 0, px, py, rad);
      rg.addColorStop(0, 'rgba(30, 26, 20, 0.10)');
      rg.addColorStop(1, 'rgba(30, 26, 20, 0)');
      x2d.fillStyle = rg;
      x2d.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    // street-level ambient occlusion (contact shading where building meets ground)
    const aoH = Math.min(70, top);
    const ao = x2d.createLinearGradient(0, top, 0, top - aoH);
    ao.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
    ao.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x2d.fillStyle = ao;
    x2d.fillRect(0, top - aoH, W, aoH);

    // --- roughness: glass reflects, masonry does not ---
    // Windows get a low value so they pick up the PMREM sky as a sharp
    // reflection; the wall around them stays rough so it reads as concrete/brick.
    const rgh = makeCanvas(W, H);
    const r2d = rgh.x;
    r2d.fillStyle = '#d9d9d9'; // 0.85 — wall
    r2d.fillRect(0, 0, W, H);
    if (hasGround) {
      r2d.fillStyle = '#8c8c8c'; // 0.55 — storefront band
      r2d.fillRect(0, top, W, H - top);
    }
    for (let f = 0; f < floors; f++) {
      const fy = top - (f + 1) * CELL;
      const show = style === 'warehouse' ? f % 2 === 0 || f === floors - 1 : true;
      if (!show) continue;
      r2d.fillStyle = style === 'glass' ? '#1a1a1a' : '#363636'; // 0.10 / 0.21
      for (let c = 0; c < cols; c++) {
        const cx0 = c * CELL;
        if (style === 'glass') r2d.fillRect(cx0 + 3, fy + 5, CELL - 6, CELL - 13);
        else if (style === 'warehouse') r2d.fillRect(cx0 + 5, fy + 6, CELL - 10, 11);
        else r2d.fillRect(cx0 + 4, fy + 4, CELL - 8, CELL - 9);
      }
    }
    const roughTex = toTexture(rgh.c, false);
    roughTex.colorSpace = THREE.NoColorSpace;

    return {
      map: toTexture(map.c, false),
      emissive: toTexture(emi.c, false),
      rough: roughTex,
    };
  });
}