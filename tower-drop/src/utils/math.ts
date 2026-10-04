import * as THREE from 'three';

/** Snap a value to the nearest grid increment */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Snap a Vector3 to grid */
export function snapVectorToGrid(vec: THREE.Vector3, gridSize: number): THREE.Vector3 {
  return new THREE.Vector3(
    snapToGrid(vec.x, gridSize),
    snapToGrid(vec.y, gridSize),
    snapToGrid(vec.z, gridSize)
  );
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth step interpolation */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/** Convert degrees to radians */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Convert radians to degrees */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

/** Get random float in range */
export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Get random int in range [min, max] */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick random element from array */
export function randChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/** Generate a pseudo-random but deterministic value from a seed */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/** 2D seeded noise */
export function seededNoise2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

/** Calculate center of mass for a collection of blocks */
export function calculateCenterOfMass(
  blocks: Array<{ position: THREE.Vector3; mass: number }>
): THREE.Vector3 {
  let totalMass = 0;
  const com = new THREE.Vector3(0, 0, 0);
  
  for (const block of blocks) {
    com.addScaledVector(block.position, block.mass);
    totalMass += block.mass;
  }
  
  if (totalMass > 0) {
    com.divideScalar(totalMass);
  }
  
  return com;
}

/** Check if a point is within a polygon (2D) */
export function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Get bounding box of a set of points */
export function getBounds(points: THREE.Vector3[]): { min: THREE.Vector3; max: THREE.Vector3 } {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  
  for (const p of points) {
    min.min(p);
    max.max(p);
  }
  
  return { min, max };
}

/** Round vector components to nearest integer */
export function roundVector(vec: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    Math.round(vec.x),
    Math.round(vec.y),
    Math.round(vec.z)
  );
}

/** Check if two vectors are approximately equal */
export function vectorsEqual(a: THREE.Vector3, b: THREE.Vector3, epsilon = 0.001): boolean {
  return a.distanceTo(b) < epsilon;
}