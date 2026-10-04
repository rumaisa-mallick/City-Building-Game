import * as THREE from 'three';

/**
 * Shared materials that react to time-of-day changes.
 * Buildings register their facade materials (emissive windows/signs),
 * street lamps register their lamp heads, roads register as wettable.
 *
 * The registry remembers the *current* scene's values, so a material
 * created later (New City, player-placed building at night, load)
 * immediately matches the active lighting instead of keeping its
 * factory default of 0.
 */
export const facadeMats = new Set<THREE.MeshStandardMaterial>();
export const lampMats = new Set<THREE.MeshStandardMaterial>();

/** Road & sidewalk materials that become shiny/wet when it rains */
export const wettableMats = new Set<THREE.MeshStandardMaterial>();

let currentWindows = 0;
let currentLamps = 0;
let currentWet = 0;
let blackoutMul = 1; // 1 = grid up, ~0.03 = city-wide power outage

/** Apply scene lighting to dynamic emissive materials */
export function applySceneEmissives(windows: number, lamps: number): void {
  currentWindows = windows;
  currentLamps = lamps;
  for (const m of facadeMats) m.emissiveIntensity = windows * blackoutMul;
  for (const m of lampMats) m.emissiveIntensity = lamps * blackoutMul;
}

/**
 * City blackout: windows and street lamps die (and come back) as one grid.
 * paint() re-applies scene emissives every frame through the same multiplier,
 * so the two paths can never disagree.
 */
export function setBlackout(mul: number): void {
  blackoutMul = mul;
  applySceneEmissives(currentWindows, currentLamps);
}

export function getBlackout(): number {
  return blackoutMul;
}

/** True when lit things are actually lit — a blackout would be visible */
export function gridUnderLoad(): boolean {
  return currentWindows > 0.25 || currentLamps > 0.25;
}

export function registerFacade(m: THREE.MeshStandardMaterial): void {
  facadeMats.add(m);
  m.emissiveIntensity = currentWindows;
}

export function registerLamp(m: THREE.MeshStandardMaterial): void {
  lampMats.add(m);
  m.emissiveIntensity = currentLamps;
}

export function registerWettable(m: THREE.MeshStandardMaterial): void {
  wettableMats.add(m);
  applyWetnessTo(m, currentWet);
}

function applyWetnessTo(m: THREE.MeshStandardMaterial, wet: number): void {
  m.roughness = 0.85 + (0.15 - 0.85) * wet;
  m.metalness = 0.05 + (0.55 - 0.05) * wet;
}

export function applyWetness(wet: number): void {
  currentWet = wet;
  for (const m of wettableMats) applyWetnessTo(m, wet);
}

/** Shared snow-cap material — meshes using it are toggled by the snow scene */
export const snowCapMaterial = new THREE.MeshStandardMaterial({
  color: '#f4f8fc',
  roughness: 0.85,
  metalness: 0,
});
