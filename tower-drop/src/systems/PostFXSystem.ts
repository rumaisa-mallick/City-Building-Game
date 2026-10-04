import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Engine } from '../core/Engine';
import type { SceneId } from '../types';

/**
 * Filmic post-processing chain:
 *
 *   RenderPass   → linear HDR scene (MSAA ×4; render targets skip tone mapping)
 *   Bloom        → physical glow: sun disc, emissive windows, lamps, headlights,
 *                  wet-road speculars — all before tone mapping, as in a real camera
 *   OutputPass   → ACES tone mapping + sRGB (reads renderer.toneMappingExposure,
 *                  which SceneSystem already sets per scene)
 *   GradePass    → per-scene color grade in display space: lift/gamma/gain,
 *                  contrast, saturation, split toning, vignette,
 *                  chromatic aberration and animated film grain
 *
 * Every scene gets a recipe tuned to how its light behaves physically:
 *   day     — blue sky bounced into shadows, warm sunlit highlights, clean/low grain
 *   morning — golden highlights against cool shadows, soft contrast, dawn haze lift
 *   sunset  — orange/teal split tone, lifted violet blacks, heavy glow, more grain
 *   night   — desaturated (Purkinje response), deep blue shadows, sodium-lamp
 *             warm highlights, strong vignette, high-ISO grain
 *   rain    — flat overcast contrast, milky lifted blacks (atmospheric haze),
 *             desaturated and cool
 */

interface GradePreset {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number; // linear HDR luminance cutoff
  exposure: number;
  contrast: number;
  saturation: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  shadowTint: [number, number, number];
  highTint: [number, number, number];
  vignette: number;
  grain: number;
  chroma: number;
}

const GRADES: Record<SceneId, GradePreset> = {
  morning: {
    bloomStrength: 0.4, bloomRadius: 0.5, bloomThreshold: 9,
    exposure: 1.12, contrast: 1.13, saturation: 1.08,
    // negative lift carves real shadow instead of milking the blacks grey
    lift: [-0.01, -0.008, 0.004], gamma: [1, 1, 1], gain: [1.03, 1.0, 0.965],
    shadowTint: [0.945, 0.975, 1.06], highTint: [1.07, 1.005, 0.9],
    vignette: 0.3, grain: 0.016, chroma: 0.0016,
  },
  day: {
    // exposure compensates the leaner sky fill in SCENES: highlights stay at
    // the top of the range while the shadows (now lit by ~40% less ambient)
    // fall away beneath them — that spread is what reads as sunlight
    // threshold stays high: at 3.0 the sun disc (in frame at 47°) bloomed into
    // a blown white halo across the skyline — only the hottest pixels glow now
    bloomStrength: 0.24, bloomRadius: 0.4, bloomThreshold: 9,
    exposure: 1.12, contrast: 1.15, saturation: 1.1,
    lift: [-0.014, -0.01, -0.002], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.985],
    shadowTint: [0.955, 0.985, 1.055], highTint: [1.035, 1.01, 0.965],
    vignette: 0.3, grain: 0.014, chroma: 0.0014,
  },
  sunset: {
    bloomStrength: 0.45, bloomRadius: 0.5, bloomThreshold: 30,
    exposure: 1.0, contrast: 1.1, saturation: 1.04,
    lift: [0.004, 0.002, 0.014], gamma: [1, 1, 1], gain: [1.06, 0.99, 0.925],
    shadowTint: [0.9, 0.95, 1.1], highTint: [1.1, 0.98, 0.85],
    vignette: 0.36, grain: 0.024, chroma: 0.0022,
  },
  night: {
    bloomStrength: 0.75, bloomRadius: 0.6, bloomThreshold: 0.6,
    exposure: 1.0, contrast: 1.13, saturation: 0.88,
    lift: [0.008, 0.013, 0.03], gamma: [1, 1, 1], gain: [0.96, 0.98, 1.045],
    shadowTint: [0.87, 0.93, 1.15], highTint: [1.1, 1.0, 0.86],
    vignette: 0.44, grain: 0.05, chroma: 0.0026,
  },
  rain: {
    bloomStrength: 0.2, bloomRadius: 0.5, bloomThreshold: 30,
    exposure: 1.05, contrast: 1.14, saturation: 1.14,
    lift: [0.002, 0.004, 0.01], gamma: [1, 1, 1], gain: [1.0, 1.0, 1.01],
    shadowTint: [0.985, 1.0, 1.02], highTint: [0.99, 1.0, 1.015],
    vignette: 0.25, grain: 0.018, chroma: 0.0018,
  },
  snow: {
    // crisp, cold and bright: blue-lifted shadows, clean whites,
    // high bloom threshold keeps the snowfield from blooming into
    // a white-out (only the sun disc / hottest highlights glow)
    bloomStrength: 0.42, bloomRadius: 0.5, bloomThreshold: 4.5,
    exposure: 1.0, contrast: 1.1, saturation: 1.04,
    lift: [0.002, 0.006, 0.018], gamma: [1, 1, 1], gain: [0.995, 1.0, 1.04],
    shadowTint: [0.93, 0.96, 1.12], highTint: [1.0, 1.01, 1.06],
    vignette: 0.3, grain: 0.014, chroma: 0.0015,
  },
};

/**
 * Lens response to the sun, per scene. Kept out of `GradePreset` on purpose:
 * these are properties of the lens and the air, not of the colour grade, so
 * they ramp with the scene blend but never touch exposure or contrast.
 *
 *   x — veiling glare  light scattered inside the lens (washes the whole frame)
 *   y — light shafts   god rays built by marching the frame toward the sun
 *   z — streak         horizontal anamorphic line through the point source
 *
 * The two broad terms are split by what they actually hit, measured on the city
 * band below the horizon with the camera aimed at a low sun (A/B on an identical
 * frame with uSunVis forced to 0):
 *
 *   city-band mean rises ~100 * x. The veil is exp(-r^2*2.6), which is much
 *   broader than it reads — the sun sits just above the horizon, so r stays
 *   small exactly where the buildings are and x lands flat across the whole
 *   band. City clipping: 7.8% at x=0, 28.2% at x=0.10, 38.7% at x=0.16,
 *   51.9% at x=0.24 (a legible city turned to white).
 *
 *   y has no falloff at all, but its march toward the sun is mostly occluded by
 *   buildings when sampled from the band, so it lifts the sky rather than the
 *   city — that is where the shafts should read. It is kept moderate so the
 *   bloom above the horizon stays hot while the city keeps its detail.
 *
 * x is therefore the one dial that decides whether the city survives.
 */
const SUN_RESPONSE: Record<SceneId, { glare: [number, number, number]; tint: [number, number, number] }> = {
  morning: { glare: [0.018, 0.05, 0.07], tint: [1.0, 0.87, 0.62] },
  day:     { glare: [0.01, 0.025, 0.03], tint: [1.0, 0.97, 0.9] },
  sunset:  { glare: [0.028, 0.06, 0.11], tint: [1.0, 0.7, 0.44] },
  night:   { glare: [0, 0, 0],           tint: [0.7, 0.8, 1.0] },
  rain:    { glare: [0.007, 0.016, 0.01], tint: [0.96, 0.97, 1.0] },
  snow:    { glare: [0.013, 0.03, 0.025], tint: [0.94, 0.97, 1.04] },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSeed: { value: 0 },
    uExposure: { value: 1 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uLift: { value: new THREE.Vector3() },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.26 },
    uGrain: { value: 0.02 },
    uChroma: { value: 0.0016 },
    uSmog: { value: 0 },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uGlare: { value: new THREE.Vector3() },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uSeed;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform vec3 uShadowTint;
    uniform vec3 uHighTint;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uSmog;
    uniform vec2 uSunPos;
    uniform float uSunVis;
    uniform vec3 uGlare;
    uniform vec3 uSunTint;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;

      // lens chromatic aberration — grows toward the frame edges
      vec2 d = uv - 0.5;
      vec2 shift = d * dot(d, d) * uChroma;
      vec3 c = vec3(
        texture2D(tDiffuse, uv + shift).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - shift).b
      );

      // display-space exposure trim
      c *= uExposure;

      // ASC-CDL style correction: gain → lift → gamma
      c = c * uGain + uLift;
      c = pow(max(c, vec3(0.0)), uGamma);

      // contrast around mid grey
      c = (c - 0.5) * uContrast + 0.5;

      // saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);

      // photochemical smog veil: warm-gray lift that eats contrast & colour
      if (uSmog > 0.003) {
        float ls = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 veil = vec3(ls) * vec3(1.05, 1.0, 0.9) * 0.92 + vec3(0.085, 0.075, 0.06);
        c = mix(c, veil, uSmog * 0.42);
      }

      // split toning: tint shadows and highlights separately
      float l2 = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      float shadowW = 1.0 - smoothstep(0.0, 0.55, l2);
      float highW = smoothstep(0.45, 1.0, l2);
      c = mix(c, c * uShadowTint, shadowW);
      c = mix(c, c * uHighTint, highW);

      // --- sun response: light shafts, veiling glare, anamorphic streak ---
      if (uSunVis > 0.002) {
        float asp = uResolution.x / max(uResolution.y, 1.0);
        float r = length((uv - uSunPos) * vec2(asp, 1.0));

        // 1. shafts — march toward the sun and keep only what is genuinely
        //    bright along the way, so rays are occluded by geometry instead of
        //    being painted straight across it
        vec3 shaft = vec3(0.0);
        float wsum = 0.0;
        for (int i = 1; i <= 12; i++) {
          float t = float(i) / 12.0;
          vec3 s = texture2D(tDiffuse, mix(uv, uSunPos, t * 0.7)).rgb;
          float m = smoothstep(0.5, 1.0, dot(s, vec3(0.2126, 0.7152, 0.0722)));
          float w = 1.0 - t;
          shaft += s * m * w;
          wsum += w;
        }
        shaft /= max(wsum, 1e-4);
        c += shaft * (uSunVis * uGlare.y) * uSunTint;

        // 2. veiling glare — scattered inside the lens, so unlike the shafts it
        //    SHOULD wash over the foreground; that is exactly what sells it
        float veil = exp(-r * r * 2.6);
        c += (uSunVis * uGlare.x * veil * (0.55 + 0.45 * l2)) * uSunTint;

        // 3. anamorphic streak — the horizontal flare an anamorphic lens throws
        //    off a hot point source
        float sx = exp(-abs(uv.x - uSunPos.x) * asp * 3.4);
        float sy = exp(-abs(uv.y - uSunPos.y) * 52.0);
        c += (uSunVis * uGlare.z * sx * sy) * uSunTint;
      }

      // aspect-correct lens vignette (uVignette = darkness at the corners)
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      float dist = length((uv - 0.5) * vec2(aspect, 1.0)) / (0.5 * sqrt(aspect * aspect + 1.0));
      float vig = 1.0 - smoothstep(0.35, 1.0, dist);
      c *= mix(1.0, vig, uVignette);

      // animated film grain — stronger in shadows, flickering at 24 fps like film
      float g = hash(floor(uv * uResolution) + vec2(uSeed * 17.13, uSeed * 31.7));
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += (g - 0.5) * uGrain * max(0.0, 1.25 - lum);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFXSystem {
  private engine: Engine;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private gtao: GTAOPass;
  private dbs = new THREE.Vector2();
  // Sun projection for the lens response — fields rather than locals because
  // update() runs every frame and must not allocate.
  private sunLight: THREE.DirectionalLight | null = null;
  private readonly sunDir = new THREE.Vector3();
  private readonly sunWorld = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  // live air-pollution getter (CitySystem.pollution) — read fresh every frame
  private smog: (() => number) | null = null;

  /** Hand PostFX the live pollution getter (drives the smog grade veil) */
  attachSmog(get: () => number): void {
    this.smog = get;
  }

  constructor(engine: Engine) {
    this.engine = engine;
    engine.renderer.getDrawingBufferSize(this.dbs);

    this.composer = new EffectComposer(engine.renderer);
    // Composer buffers bypass the canvas' own antialiasing — restore it with MSAA.
    // samples is read when the framebuffer is first created (first render), so
    // assigning it here, before engine.start(), takes effect.
    this.composer.renderTarget1.samples = 4;
    this.composer.renderTarget2.samples = 4;

    this.bloom = new UnrealBloomPass(this.dbs.clone(), 0.32, 0.45, 1.15);
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms['uResolution'].value.copy(this.dbs);

    // Ground-truth ambient occlusion — the biggest "this is a real place" cue a
    // flat-lit city is missing: contact darkening where buildings meet the
    // ground, in the alleys, under awnings and tree canopies. It runs on the
    // linear HDR buffer (before OutputPass) so occlusion multiplies actual
    // light instead of a tone-mapped picture, and it builds its own
    // depth + normal G-buffer for the job.
    this.gtao = new GTAOPass(engine.scene, engine.camera, this.dbs.x, this.dbs.y);
    this.gtao.blendIntensity = 0.8;
    this.gtao.updateGtaoMaterial({
      // world-space radius: a few metres of contact darkening reads at this
      // city scale (roads ~10 m, blocks ~30 m) without turning into grime
      radius: 3, distanceExponent: 1.5, thickness: 1.4, scale: 1,
      samples: 12, distanceFallOff: 1, screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({
      lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1,
      rings: 2, samples: 8,
    });

    this.composer.addPass(new RenderPass(engine.scene, engine.camera));
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);

    engine.renderOverride = () => this.composer.render();
    engine.on('sceneChanged', ({ scene }) => this.applyPreset(scene));
    engine.on('sceneBlended', ({ a, b, e }) => this.blendPreset(a, b, e));
    window.addEventListener('resize', () => this.onResize());
    this.applyPreset('day');
  }

  private onResize(): void {
    this.engine.renderer.getDrawingBufferSize(this.dbs);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.grade.uniforms['uResolution'].value.copy(this.dbs);
  }

  /** Switch bloom + grade recipe when the scene (time of day / weather) changes. */
  applyPreset(id: SceneId): void {
    this.blendPreset(id, id, 0);
  }

  /**
   * Graded midpoint between two scene recipes — used every frame of a
   * time-lapse blend. The bloom threshold MUST follow the sky: sticking to
   * the night recipe (0.6) while the dawn brightens blooms the whole horizon
   * into a white wash.
   */
  blendPreset(aId: SceneId, bId: SceneId, e: number): void {
    const A = GRADES[aId];
    const B = GRADES[bId];
    const L = THREE.MathUtils.lerp;
    this.bloom.strength = L(A.bloomStrength, B.bloomStrength, e);
    this.bloom.radius = L(A.bloomRadius, B.bloomRadius, e);
    this.bloom.threshold = L(A.bloomThreshold, B.bloomThreshold, e);

    const u = this.grade.uniforms;
    u['uExposure'].value = L(A.exposure, B.exposure, e);
    u['uContrast'].value = L(A.contrast, B.contrast, e);
    u['uSaturation'].value = L(A.saturation, B.saturation, e);
    u['uVignette'].value = L(A.vignette, B.vignette, e);
    u['uGrain'].value = L(A.grain, B.grain, e);
    u['uChroma'].value = L(A.chroma, B.chroma, e);
    const L3 = (name: 'lift' | 'gamma' | 'gain' | 'shadowTint' | 'highTint'): void => {
      u[`u${name[0].toUpperCase()}${name.slice(1)}`].value.set(
        L(A[name][0], B[name][0], e), L(A[name][1], B[name][1], e), L(A[name][2], B[name][2], e));
    };
    L3('lift'); L3('gamma'); L3('gain'); L3('shadowTint'); L3('highTint');

    // lens response rides the same blend as the grade it sits underneath
    const SA = SUN_RESPONSE[aId];
    const SB = SUN_RESPONSE[bId];
    u['uGlare'].value.set(
      L(SA.glare[0], SB.glare[0], e), L(SA.glare[1], SB.glare[1], e), L(SA.glare[2], SB.glare[2], e));
    u['uSunTint'].value.set(
      L(SA.tint[0], SB.tint[0], e), L(SA.tint[1], SB.tint[1], e), L(SA.tint[2], SB.tint[2], e));
  }

  update(_dt: number, elapsed: number): void {
    // reseed grain 24 times a second so it flickers like film instead of
    // sitting still like a dirty lens
    this.grade.uniforms['uSeed'].value = Math.floor(elapsed * 24);
    this.grade.uniforms['uSmog'].value = Math.min(1, Math.max(0, this.smog?.() ?? 0));
    this.updateSun();
  }

  /** Screen position of the sun and how much of it the lens can see. */
  private updateSun(): void {
    const u = this.grade.uniforms;

    if (this.sunLight === null) {
      const found = this.engine.scene.children.find(
        (o) => (o as THREE.DirectionalLight).isDirectionalLight
      );
      if (!found) { u['uSunVis'].value = 0; return; }
      this.sunLight = found as THREE.DirectionalLight;
    }

    // A DirectionalLight's sun sits at infinity along +position (its target is
    // at the origin), so aim from the camera down that ray. Projecting the
    // light's own 260-unit position would parallax against the city instead.
    this.sunDir.copy(this.sunLight.position).normalize();

    // a sun below the horizon throws no glare...
    const up = THREE.MathUtils.smoothstep(this.sunDir.y, -0.02, 0.14);
    this.engine.camera.getWorldDirection(this.camFwd);
    if (up <= 0 || this.camFwd.dot(this.sunDir) < 0.02) {
      u['uSunVis'].value = 0;
      return;
    }

    this.sunWorld
      .copy(this.engine.camera.position)
      .addScaledVector(this.sunDir, 4000)
      .project(this.engine.camera);
    u['uSunPos'].value.set(this.sunWorld.x * 0.5 + 0.5, this.sunWorld.y * 0.5 + 0.5);

    // ...and it fades as the source leaves the frame: the scatter happens in
    // the lens so it survives a little past the edge, but not out to the corners
    const off = Math.max(0, Math.abs(this.sunWorld.x) - 1, Math.abs(this.sunWorld.y) - 1);
    u['uSunVis'].value = up * Math.max(0, 1 - off / 0.8);
  }
}
