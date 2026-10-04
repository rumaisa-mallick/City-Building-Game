import * as THREE from 'three';

/**
 * Height fog — haze pools near the ground and thins with altitude.
 *
 * Three's fog is purely distance-based, so a hilltop 900 units away fogs exactly
 * as hard as the street in front of it. That flattens the image: the skyline ends
 * up as milky as the road, which is what makes a rendered city look like a
 * diorama instead of a place. Real aerial perspective is height-aware — the
 * density of the air you are looking *through* falls off with altitude — so
 * distant low ground goes soft while towers keep their contrast against it.
 *
 * Implementation notes
 *  - Overriding `THREE.ShaderChunk.fog_*` means every built-in material picks it
 *    up automatically: `resolveIncludes()` runs at program-compile time, so this
 *    only has to happen before the first render.
 *  - World Y is taken from the `position` attribute rather than `transformed`
 *    because `<fog_vertex>` is also pulled into shaders (sprite, shadow, lines)
 *    that never include `<begin_vertex>`; `position` is in the vertex prefix
 *    unconditionally. Instancing is applied so instance Y is correct.
 *  - The falloff constants are literals. Three rebuilds its fog uniforms from
 *    `scene.fog` every frame and knows nothing about a fourth one, so a custom
 *    uniform would silently stay at its boot value. Distance control still comes
 *    from `scene.fog.near/.far/.color`, which remain fully dynamic per scene.
 *
 * @param scale   exponential falloff per world unit (0.02 → scale height 50)
 * @param ground  world Y the haze is densest at (the terrain sits near y=0)
 * @param blend   0 = ignore height, 1 = full height control
 */
export function installHeightFog(scale = 0.018, ground = 0, blend = 0.8): void {
  const s = scale.toFixed(5);
  const g = ground.toFixed(2);
  const b = blend.toFixed(3);
  const C = THREE.ShaderChunk;

  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vWorldY;
#endif`;

  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vec4 fogWorldPos = vec4( position, 1.0 );
	#ifdef USE_INSTANCING
		fogWorldPos = instanceMatrix * fogWorldPos;
	#endif
	vWorldY = ( modelMatrix * fogWorldPos ).y;
#endif`;

  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vWorldY;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;

  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float fogHeight = exp( - max( vWorldY - ${g}, 0.0 ) * ${s} );
	fogFactor *= mix( 1.0, fogHeight, ${b} );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
