import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { SceneId, WeatherMod } from '../types';
import { GRID, TOTAL, roadCenter } from '../types';
import { applySceneEmissives, applyWetness, getBlackout } from '../utils/materialRegistry';
import { Engine } from '../core/Engine';

interface ScenePreset {
  id: SceneId;
  name: string;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  turbidity: number;
  rayleigh: number;
  mie: number; // Mie scattering — atmospheric haze/glow near the horizon
  cloudCoverage: number; // 0 = clear sky, 1 = fully overcast
  cloudDensity: number;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  exposure: number;
  env: number;
  windows: number;
  lamps: number;
  stars: number;
  rain: number;
  snow: number;
}

export const SCENES: ScenePreset[] = [
  {
    id: 'morning', name: '🌅 Morning',
    sunElevation: 10, sunAzimuth: 100, sunColor: '#ffcb85', sunIntensity: 2.25,
    hemiSky: '#cdddf0', hemiGround: '#6b6152', hemiIntensity: 0.3,
    turbidity: 6, rayleigh: 2.5, mie: 0.008, cloudCoverage: 0.3, cloudDensity: 0.45,
    fogColor: '#e5e1d6', fogNear: 215, fogFar: 1050,
    exposure: 1.05, env: 0.46, windows: 0.05, lamps: 0.15, stars: 0, rain: 0, snow: 0,
  },
  {
    id: 'day', name: '☀️ Day',
    // Lower sun = longer, readable cast shadows. Sky fill is deliberately lean
    // (env 0.35 → 0.21): at 0.35 the ambient term filled every shadow until the
    // whole frame sat in the top third of the range and read flat/milky.
    sunElevation: 47, sunAzimuth: 35, sunColor: '#fffaf0', sunIntensity: 3.2,
    hemiSky: '#cfe0f5', hemiGround: '#6e6a5e', hemiIntensity: 0.155,
    turbidity: 3.6, rayleigh: 1.7, mie: 0.004, cloudCoverage: 0.22, cloudDensity: 0.45,
    // push the aerial haze past the city so the skyline keeps contrast and only
    // the far hills dissolve — fog at 245/900 was bleaching the whole horizon
    fogColor: '#cddcf0', fogNear: 315, fogFar: 1450,
    exposure: 0.95, env: 0.21, windows: 0, lamps: 0, stars: 0, rain: 0, snow: 0,
  },
  {
    id: 'sunset', name: '🌇 Sunset',
    sunElevation: 4.5, sunAzimuth: -55, sunColor: '#ff9a4d', sunIntensity: 2.0,
    hemiSky: '#ffb37a', hemiGround: '#4a3428', hemiIntensity: 0.4,
    turbidity: 8, rayleigh: 3, mie: 0.005, cloudCoverage: 0.35, cloudDensity: 0.5,
    fogColor: '#f0b088', fogNear: 120, fogFar: 500,
    exposure: 1.0, env: 0.55, windows: 0.4, lamps: 0.55, stars: 0.1, rain: 0, snow: 0,
  },
  {
    id: 'night', name: '🌙 Night',
    // pre-dawn position: just below the eastern horizon (az ≈ 105°) so the
    // time-lapse night→morning leg lifts the sun straight up from behind
    // the sunrise ridge instead of sweeping in from the south
    sunElevation: -6, sunAzimuth: 105, sunColor: '#5a7ac0', sunIntensity: 0.28,
    hemiSky: '#1a2440', hemiGround: '#0a0e14', hemiIntensity: 0.22,
    turbidity: 3, rayleigh: 0.6, mie: 0.005, cloudCoverage: 0.08, cloudDensity: 0.4,
    fogColor: '#0a0e1c', fogNear: 110, fogFar: 430,
    exposure: 1.18, env: 0.5, windows: 1.1, lamps: 1.3, stars: 1, rain: 0, snow: 0,
  },
  {
    id: 'rain', name: '🌧 Rain',
    sunElevation: 38, sunAzimuth: 60, sunColor: '#f4f2ed', sunIntensity: 0.72,
    hemiSky: '#dde2e9', hemiGround: '#4a4d4a', hemiIntensity: 0.5,
    turbidity: 14, rayleigh: 0.85, mie: 0.012, cloudCoverage: 0.9, cloudDensity: 0.65,
    fogColor: '#78828e', fogNear: 270, fogFar: 980,
    exposure: 0.88, env: 0.3, windows: 0.4, lamps: 0.7, stars: 0, rain: 1, snow: 0,
  },
  {
    id: 'snow', name: '❄️ Snow',
    sunElevation: 24, sunAzimuth: 75, sunColor: '#eef2ff', sunIntensity: 1.7,
    hemiSky: '#e8eef8', hemiGround: '#c2c8d0', hemiIntensity: 0.55,
    turbidity: 8, rayleigh: 1.3, mie: 0.007, cloudCoverage: 0.55, cloudDensity: 0.5,
    fogColor: '#dde5ee', fogNear: 230, fogFar: 900,
    exposure: 1.0, env: 0.7, windows: 0.3, lamps: 0.45, stars: 0, rain: 0, snow: 1,
  },
];

/** Scenes the time-lapse rolls through (weather stays manual) */
export const TIME_CYCLE: SceneId[] = ['morning', 'day', 'sunset', 'night'];

/** Fog tint the weather gray-down lerps toward */
const PAINT_GRAY = new THREE.Color('#8d95a1');
/** Fog tint pollution lerps toward — warm gray-brown, the classic smog hue */
const SMOG_TAN = new THREE.Color('#9b9280');

/**
 * Realistic sky (three.js Sky shader), sun with shadows,
 * fog, stars, rain, and time-of-day emissive control.
 */
export class SceneSystem {
  current: SceneId = 'day';

  private sky: Sky;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private stars: THREE.Points;
  private rain: THREE.LineSegments;
  private rainSpeeds: Float32Array;
  private snow: THREE.Points;
  private snowSpeeds: Float32Array;
  private snowSway: Float32Array;
  private snowT = 0;
  private lampPoints: THREE.PointLight[] = [];

  // dynamic weather: the live modifier (shared object from WeatherSystem)
  // plus the unmodified base-preset values paint() re-applies it on top of.
  private weather: WeatherMod | null = null;
  private rainTilt = 0;
  private base = {
    cloud: 0.22, turb: 3.6, rayl: 1.7, mie: 0.004, sunI: 3, hemiI: 0.18,
    exposure: 1, fogColor: new THREE.Color('#d0e0f0'), fogNear: 245, fogFar: 900,
    lamps: 0, windows: 0, stars: 0, rain: 0, snow: 0,
  };
  // live air-pollution getter (CitySystem.pollution) — read fresh every frame
  private smog: (() => number) | null = null;

  /** Hand SceneSystem the live pollution getter (read fresh every frame) */
  attachSmog(get: () => number): void {
    this.smog = get;
    this.paint();
  }

  /** Hand SceneSystem the live weather modifier (read fresh every frame) */
  attachWeather(mod: WeatherMod): void {
    this.weather = mod;
    this.paint();
  }

  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envSky = new Sky();
  private envScene = new THREE.Scene();

  private engine: Engine;

  // time-lapse: continuously blend through TIME_CYCLE, snapping at each end
  private tlActive = false;
  private tlClock = 0;
  private tlHold = 20; // seconds per transition (user-cycleable via cyclePace)
  private tlFrom: ScenePreset = SCENES[1];
  private tlTo: ScenePreset = SCENES[2];

  /** Seconds-per-phase options for the time-lapse; default 20 (was 10). */
  private static readonly PACES = [12, 20, 40];
  private paceIdx = 1;

  get paceSeconds(): number {
    return SceneSystem.PACES[this.paceIdx];
  }

  /** Cycle 12 → 20 → 40 s per phase; returns the new duration. */
  cyclePace(): number {
    this.paceIdx = (this.paceIdx + 1) % SceneSystem.PACES.length;
    this.tlHold = SceneSystem.PACES[this.paceIdx];
    return this.tlHold;
  }

  /** The night→morning leg runs 1.5× longer so the mountain sunrise lingers. */
  private legHold(): number {
    return this.tlHold * (this.tlTo.id === 'morning' ? 1.5 : 1);
  }

  constructor(engine: Engine) {
    this.engine = engine;

    // --- Sky ---
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    engine.scene.add(this.sky);

    // A small copy of the sky used only for baking environment maps,
    // so glass and metals reflect the actual sky of the current scene.
    this.envSky.scale.setScalar(400);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(engine.renderer);

    // --- Sun ---
    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = true;
    // 4096 over a tightened frustum ≈ 11 texels/unit (was ~5): shadow edges
    // stop reading as jagged staircase lines when the camera comes down low
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    const ext = TOTAL / 2 + 45; // cover the grid; the outskirts only receive
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.015;
    // wider PCF kernel: real sunlight has a penumbra that widens with distance
    this.sun.shadow.radius = 3.2;
    engine.scene.add(this.sun);
    engine.scene.add(this.sun.target);

    // --- Hemisphere ambient ---
    this.hemi = new THREE.HemisphereLight('#cfe0f2', '#6a7a5a', 0.7);
    engine.scene.add(this.hemi);

    // warm lamp pools at the road intersections so the glow lands on the
    // street instead of inside a block/building: the four central crossings
    // plus the four outer-inner crossings of the grid (deduped for GRID=3).
    const mid = new Set([Math.floor(GRID / 2), Math.ceil(GRID / 2)]);
    const outer = new Set([1, GRID - 1]);
    const keys = new Set<string>();
    for (const a of mid) for (const b of mid) keys.add(`${a},${b}`);
    for (const a of outer) for (const b of outer) keys.add(`${a},${b}`);
    for (const key of keys) {
      const [ka, kb] = key.split(',').map(Number);
      const pl = new THREE.PointLight('#ffcf8a', 0, 90, 1.6);
      pl.position.set(roadCenter(ka), 7, roadCenter(kb));
      engine.scene.add(pl);
      this.lampPoints.push(pl);
    }

    // --- Stars ---
    this.stars = this.buildStars();
    engine.scene.add(this.stars);

    // --- Rain ---
    const rainData = this.buildRain();
    this.rain = rainData.rain;
    this.rainSpeeds = rainData.speeds;
    this.rain.visible = false;
    engine.scene.add(this.rain);

    // --- Snow ---
    const snowData = this.buildSnow();
    this.snow = snowData.points;
    this.snowSpeeds = snowData.speeds;
    this.snowSway = snowData.sway;
    this.snow.visible = false;
    engine.scene.add(this.snow);

    this.apply('day');
  }

  private buildStars(): THREE.Points {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const r = (s: number): number => Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < N; i++) {
      const theta = r(i + 1) * Math.PI * 2;
      const phi = r(i + 77) * Math.PI * 0.48; // upper hemisphere
      const rad = 420;
      pos[i * 3] = Math.cos(theta) * Math.cos(phi) * rad;
      pos[i * 3 + 1] = Math.sin(phi) * rad + 10;
      pos[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * rad;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    return new THREE.Points(geo, mat);
  }

  private buildRain(): { rain: THREE.LineSegments; speeds: Float32Array } {
    const N = 1400;
    const pos = new Float32Array(N * 6);
    const speeds = new Float32Array(N);
    const LEN = 1.4;
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 220;
      const y = Math.random() * 70;
      const z = (Math.random() - 0.5) * 220;
      pos[i * 6] = x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x;
      pos[i * 6 + 4] = y - LEN;
      pos[i * 6 + 5] = z;
      speeds[i] = 26 + Math.random() * 22;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#9fb8d8',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      fog: false,
    });
    return { rain: new THREE.LineSegments(geo, mat), speeds };
  }

  private buildSnow(): { points: THREE.Points; speeds: Float32Array; sway: Float32Array } {
    const N = 1600;
    const pos = new Float32Array(N * 3);
    const speeds = new Float32Array(N);
    const sway = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 220;
      pos[i * 3 + 1] = Math.random() * 70;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 220;
      speeds[i] = 1.6 + Math.random() * 2.6;
      sway[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 0.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    });
    return { points: new THREE.Points(geo, mat), speeds, sway };
  }

  apply(id: SceneId, fromTimelapse = false): void {
    // a manual scene change (M key, pills, load) stops the time-lapse
    if (!fromTimelapse) this.tlActive = false;
    const p = SCENES.find((s) => s.id === id) || SCENES[1];
    this.current = id;

    // sun direction
    const phi = THREE.MathUtils.degToRad(90 - p.sunElevation);
    const theta = THREE.MathUtils.degToRad(p.sunAzimuth);
    const sunVec = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(sunVec);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie;
    u.mieDirectionalG.value = 0.8;
    u.cloudCoverage.value = p.cloudCoverage;
    u.cloudDensity.value = p.cloudDensity;

    // bake the sky into an environment map for realistic reflections —
    // pollution hazes this too, so glass/metal pick up the smog on scene changes
    const smog = Math.min(1, Math.max(0, this.smog?.() ?? 0));
    const eu = this.envSky.material.uniforms;
    eu.sunPosition.value.copy(sunVec);
    eu.turbidity.value = p.turbidity + smog * 13;
    eu.rayleigh.value = p.rayleigh * (1 - smog * 0.55);
    eu.mieCoefficient.value = p.mie + smog * 0.012;
    eu.mieDirectionalG.value = 0.8;
    eu.cloudCoverage.value = p.cloudCoverage;
    eu.cloudDensity.value = p.cloudDensity;
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 3000);
    this.engine.scene.environment = this.envRT.texture;
    this.engine.scene.environmentIntensity = p.env;

    // wet, reflective roads & sidewalks in the rain
    applyWetness(p.rain);

    this.sun.position.copy(sunVec).multiplyScalar(260);
    this.sun.position.y = Math.max(this.sun.position.y, p.sunElevation < 0 ? 120 : 30);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;

    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;

    this.engine.scene.fog = new THREE.Fog(p.fogColor, p.fogNear, p.fogFar);
    this.engine.renderer.toneMappingExposure = p.exposure;

    // emissives: windows & lamps
    applySceneEmissives(p.windows, p.lamps);
    for (const pl of this.lampPoints) pl.intensity = p.lamps * 60 * getBlackout();

    // stars, rain & snow (paint() below owns the final values)
    this.setBase(p);
    this.paint();

    this.engine.emit('sceneChanged', { scene: id });
  }

  update(dt: number): void {
    // weather/lightning repaint first so the frame uses fresh modifier values
    this.paint();

    // keep precipitation around the camera — it only covers ±110 units,
    // so without this it vanished whenever you panned toward the map edge
    if (this.rain.visible) {
      this.rain.position.x = this.engine.camera.position.x;
      this.rain.position.z = this.engine.camera.position.z;
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const tilt = this.rainTilt;
      const slantX = tilt * 0.5; // sideways velocity while the wind blows
      for (let i = 0; i < this.rainSpeeds.length; i++) {
        const fall = this.rainSpeeds[i] * dt;
        arr[i * 6 + 1] -= fall;
        arr[i * 6 + 4] -= fall;
        if (tilt > 0.001) arr[i * 6] += fall * slantX;
        // tilted streaks while windy, straight drops otherwise
        arr[i * 6 + 3] = arr[i * 6] + tilt * 1.5;
        if (arr[i * 6 + 1] < 0) {
          const ny = 70;
          arr[i * 6 + 1] = ny;
          arr[i * 6 + 4] = ny - 1.4;
          arr[i * 6] = (Math.random() - 0.5) * 220; // re-scatter on wrap (drift)
        }
      }
      pos.needsUpdate = true;
    }

    if (this.snow.visible) {
      this.snowT += dt;
      this.snow.position.x = this.engine.camera.position.x;
      this.snow.position.z = this.engine.camera.position.z;
      const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < this.snowSpeeds.length; i++) {
        arr[i * 3 + 1] -= this.snowSpeeds[i] * dt;
        // gentle side-to-side drift while falling
        arr[i * 3] += Math.sin(this.snowT * 0.9 + this.snowSway[i]) * dt * 1.1;
        arr[i * 3 + 2] += Math.cos(this.snowT * 0.7 + this.snowSway[i]) * dt * 0.7;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 70;
          arr[i * 3] = (Math.random() - 0.5) * 220;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 220;
        }
      }
      pos.needsUpdate = true;
    }

    // rolling day cycle: blend toward the next scene, snap exactly on arrival
    if (this.tlActive) {
      this.tlClock += dt;
      const t = Math.min(1, this.tlClock / this.legHold());
      const e = t * t * (3 - 2 * t); // smoothstep
      this.blendScene(this.tlFrom, this.tlTo, e);
      if (t >= 1) {
        this.tlClock = 0;
        const next = this.tlTo.id;
        this.apply(next, true);
        const i = TIME_CYCLE.indexOf(next);
        this.tlFrom = this.tlTo;
        this.tlTo = SCENES.find((s) => s.id === TIME_CYCLE[(i + 1) % TIME_CYCLE.length]) || SCENES[0];
      }
    }
  }

  get timelapseActive(): boolean {
    return this.tlActive;
  }

  /** Start/stop the rolling day cycle (morning → day → sunset → night → …) */
  toggleTimelapse(): boolean {
    if (this.tlActive) {
      this.tlActive = false;
      return false;
    }
    const i = TIME_CYCLE.indexOf(this.current);
    const fromIdx = i < 0 ? 1 : i; // weather scenes start from 'day'
    this.tlFrom = SCENES.find((s) => s.id === this.current) || SCENES[1];
    this.tlTo = SCENES.find((s) => s.id === TIME_CYCLE[(fromIdx + 1) % TIME_CYCLE.length]) || SCENES[1];
    this.tlActive = true;
    this.tlClock = 0;
    return true;
  }

  /**
   * Continuous interpolation between two presets (no env-map rebake, no
   * event storm — the exact snap happens in apply() when the blend lands).
   */
  private blendScene(a: ScenePreset, b: ScenePreset, e: number): void {
    const L = THREE.MathUtils.lerp;
    const phi = THREE.MathUtils.degToRad(L(90 - a.sunElevation, 90 - b.sunElevation, e));
    const theta = THREE.MathUtils.degToRad(L(a.sunAzimuth, b.sunAzimuth, e));
    const sunVec = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(sunVec);
    u.turbidity.value = L(a.turbidity, b.turbidity, e);
    u.rayleigh.value = L(a.rayleigh, b.rayleigh, e);
    u.mieCoefficient.value = L(a.mie, b.mie, e);
    u.mieDirectionalG.value = 0.8;
    u.cloudCoverage.value = L(a.cloudCoverage, b.cloudCoverage, e);
    u.cloudDensity.value = L(a.cloudDensity, b.cloudDensity, e);

    applyWetness(L(a.rain, b.rain, e));

    this.sun.position.copy(sunVec).multiplyScalar(260);
    const elev = L(a.sunElevation, b.sunElevation, e);
    this.sun.position.y = Math.max(this.sun.position.y, elev < 0 ? 120 : 30);
    this.sun.color.lerpColors(new THREE.Color(a.sunColor), new THREE.Color(b.sunColor), e);
    this.sun.intensity = L(a.sunIntensity, b.sunIntensity, e);

    this.hemi.color.lerpColors(new THREE.Color(a.hemiSky), new THREE.Color(b.hemiSky), e);
    this.hemi.groundColor.lerpColors(new THREE.Color(a.hemiGround), new THREE.Color(b.hemiGround), e);
    this.hemi.intensity = L(a.hemiIntensity, b.hemiIntensity, e);

    const fog = this.engine.scene.fog as THREE.Fog | null; // apply() always creates a linear Fog
    if (fog) {
      fog.color.lerpColors(new THREE.Color(a.fogColor), new THREE.Color(b.fogColor), e);
      fog.near = L(a.fogNear, b.fogNear, e);
      fog.far = L(a.fogFar, b.fogFar, e);
    }
    this.engine.renderer.toneMappingExposure = L(a.exposure, b.exposure, e);

    const lamps = L(a.lamps, b.lamps, e);
    applySceneEmissives(L(a.windows, b.windows, e), lamps);
    for (const pl of this.lampPoints) pl.intensity = lamps * 60 * getBlackout();

    this.setBaseLerp(a, b, e);
    // keep the postfx grade tracking the sky (bloom threshold especially)
    this.engine.emit('sceneBlended', { a: a.id, b: b.id, e });
    this.paint(); // also owns stars/rain/snow visibility from the base
  }

  // =====================================================================
  // Weather paint — base preset + live modifier, re-applied every frame
  // =====================================================================

  private setBase(p: ScenePreset): void {
    const b = this.base;
    b.cloud = p.cloudCoverage; b.turb = p.turbidity; b.rayl = p.rayleigh;
    b.mie = p.mie;
    b.sunI = p.sunIntensity; b.hemiI = p.hemiIntensity; b.exposure = p.exposure;
    b.fogColor.set(p.fogColor); b.fogNear = p.fogNear; b.fogFar = p.fogFar;
    b.lamps = p.lamps; b.windows = p.windows; b.stars = p.stars;
    b.rain = p.rain; b.snow = p.snow;
  }

  private setBaseLerp(a: ScenePreset, b2: ScenePreset, e: number): void {
    const L = THREE.MathUtils.lerp;
    const b = this.base;
    b.cloud = L(a.cloudCoverage, b2.cloudCoverage, e);
    b.turb = L(a.turbidity, b2.turbidity, e);
    b.rayl = L(a.rayleigh, b2.rayleigh, e);
    b.mie = L(a.mie, b2.mie, e);
    b.sunI = L(a.sunIntensity, b2.sunIntensity, e);
    b.hemiI = L(a.hemiIntensity, b2.hemiIntensity, e);
    b.exposure = L(a.exposure, b2.exposure, e);
    b.fogColor.lerpColors(new THREE.Color(a.fogColor), new THREE.Color(b2.fogColor), e);
    b.fogNear = L(a.fogNear, b2.fogNear, e);
    b.fogFar = L(a.fogFar, b2.fogFar, e);
    b.lamps = L(a.lamps, b2.lamps, e);
    b.windows = L(a.windows, b2.windows, e);
    b.stars = L(a.stars, b2.stars, e);
    b.rain = L(a.rain, b2.rain, e);
    b.snow = L(a.snow, b2.snow, e);
  }

  /**
   * Deterministic re-application of base + weather modifier. Runs after
   * apply()/blendScene() and every frame, so it must never compound:
   * every value is recomputed from `base` alone. With no modifier attached
   * it reproduces the preset exactly.
   */
  private paint(): void {
    const b = this.base;
    const w = this.weather;
    const smog = Math.min(1, Math.max(0, this.smog?.() ?? 0));
    const clouds = Math.min(1, b.cloud + (w?.clouds ?? 0) * 0.7 + smog * 0.15);
    const gray = w?.gray ?? 0;
    const dim = w?.dim ?? 0;
    const flash = w?.flash ?? 0;

    const u = this.sky.material.uniforms;
    u.cloudCoverage.value = clouds;
    // pollution scatters like dust: turbidity up, blue sky washed to milky gray
    u.turbidity.value = b.turb + gray * 9 + smog * 13;
    u.rayleigh.value = b.rayl * (1 - gray * 0.55) * (1 - smog * 0.55);
    u.mieCoefficient.value = b.mie + smog * 0.012;

    // haze dims the direct sun and takes a little bounce out of the sky light
    this.sun.intensity = Math.max(0.03, b.sunI * (1 - dim * 0.78) * (1 - smog * 0.35) + flash * 2.4);
    this.hemi.intensity = b.hemiI * (1 - dim * 0.5) * (1 - smog * 0.15) + flash * 2.6;

    const fog = this.engine.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(b.fogColor).lerp(PAINT_GRAY, gray * 0.45).lerp(SMOG_TAN, smog * 0.5);
      fog.near = b.fogNear * (1 - clouds * 0.3) * (1 - smog * 0.3);
      fog.far = b.fogFar * (1 - clouds * 0.35) * (1 - smog * 0.45);
    }
    this.engine.renderer.toneMappingExposure = b.exposure * (1 - dim * 0.22) * (1 - smog * 0.08) + flash * 0.75;

    // heavy overcast flips the streetlights on even at midday
    const lamps = Math.max(b.lamps, dim * 0.8);
    applySceneEmissives(b.windows, lamps);
    for (const pl of this.lampPoints) pl.intensity = lamps * 60 * getBlackout();

    applyWetness(Math.max(b.rain, w?.wet ?? 0));

    const rainAmt = Math.max(b.rain, w?.rain ?? 0);
    const snowAmt = Math.max(b.snow, w?.snow ?? 0);
    this.rain.visible = rainAmt > 0.01;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.18 + 0.42 * rainAmt;
    this.rainTilt = w?.tilt ?? 0;
    this.snow.visible = snowAmt > 0.01;
    if (this.snow.visible) {
      (this.snow.material as THREE.PointsMaterial).opacity = 0.35 + 0.55 * snowAmt;
    }

    const stars = b.stars * (1 - clouds) * (1 - smog * 0.7); // smog eats the stars too
    (this.stars.material as THREE.PointsMaterial).opacity = stars;
    this.stars.visible = stars > 0.01;
  }

  /** Cycle to the next scene (used by M key) */
  cycle(): SceneId {
    const i = SCENES.findIndex((s) => s.id === this.current);
    const next = SCENES[(i + 1) % SCENES.length];
    this.apply(next.id);
    return next.id;
  }
}