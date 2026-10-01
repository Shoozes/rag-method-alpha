# Raymarching

In real-world applications, TSL enables developers to create entirely new syntaxes and custom abstractions to accommodate different graphics workflows. Rather than being restricted to a fixed shader language, you can construct custom DSLs (Domain-Specific Languages), modular utility functions, or dedicated shading models that align with the architectural needs of your project.

This flexibility allows shader logic to be composed dynamically like JavaScript components, making it possible to design clean APIs for complex math, custom material models, or post-processing pipelines.

### Raymarching as a TSL Extension

The `RaymarchingBox` utility is a practical example of how TSL's core syntax was extended to support a specialized volumetric rendering workflow. It abstracts the local ray calculation relative to a bounding volume (from `-0.5` to `0.5`), computes bounding-box intersections, and runs the step-by-step marching loop inside a custom utility.

By wrapping this complex pipeline, the workflow for creating volumetric materials is simplified into a callback interface where you only define what happens at each sample point along the ray.

<code name="raymarchingExample" default="true">Raymarching Box Example</code>

```tsl raymarchingExample
import 'scenes/empty';
import * as THREE from 'three';
import { Fn, vec4, vec3, time, If, smoothstep, exp, Break, modelWorldMatrixInverse, triNoise3D, pmremTexture, modelWorldMatrix } from 'three/tsl';
import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js';

// Volumetric cloud density calculator (simplified ellipsoid shape with warping and edge noise erosion)
const getCloudDensity = Fn( ( [ p ] ) => {

	// 1. Warp coordinate space to deform the geometric boundaries organically (Domain Warping)
	const warp = triNoise3D( p, 0.5, time.mul( 0.5 ) );
	const pWarped = p.add( vec3( warp ).sub( 0.5 ).mul( 0.4 ) );

	// 2. Base Ellipsoid Mask (wider than it is tall to look like a flat cumulus cloud)
	const baseMask = smoothstep( 0.48, 0.22, pWarped.mul( vec3( 1, 1.3, 1 ) ).length() );

	// 3. Volumetric details with slow wind drift
	const pNoise = pWarped.add( vec3( time.mul( 0.05 ), 0, time.mul( 0.02 ) ) );
	const noiseVal = triNoise3D( pNoise.mul( 1.2 ), 1.2, time.mul( 0.6 ) );

	// Erode only the edges of the cloud, keeping the center core solid
	const shape = baseMask.sub( noiseVal.mul( baseMask.pow( 2 ).oneMinus().mul( 0.48 ) ) );

	// Soft threshold to get beautiful rounded boundaries with smooth fade-out
	return smoothstep( - 0.02, 0.35, shape );

} );

const raymarchClouds = Fn( () => {

	const steps = 48;

	const finalColor = vec4( 0 );

	// Direct light source (constant direction from top-right-front, matching the reference image)
	const lightDir = vec3( 1, 1.2, 0.8 ).normalize();
	const localLightDir = modelWorldMatrixInverse.mul( vec4( lightDir, 0 ) ).xyz.normalize();

	// Direct light color matching the reference sun light
	const directLightColor = vec3( 0.5, 1.0, 1.4 );

	RaymarchingBox( steps, ( { positionRay, stepSize } ) => {

		const density = getCloudDensity( positionRay );

		If( density.greaterThan( 0.01 ), () => {

			// Shadow ray: sample density offset towards the light source in local space
			const shadowPos = positionRay.add( localLightDir.mul( 0.08 ) );
			const shadowDensity = getCloudDensity( shadowPos );

			// Dual-Lobe Beer's Law for realistic multiple scattering & light penetration
			const shadowVal = shadowDensity.mul( 10 );
			const transmittance = exp( shadowVal.negate() ).mul( 0.5 ).add( exp( shadowVal.mul( 0.1 ).negate() ).mul( 0.65 ) );

			// Calculate local normal based on positionRay relative to cloud center
			const normal = positionRay.normalize();

			// Transform normal to world space so environment directions align correctly with the sky
			const worldNormal = modelWorldMatrix.mul( vec4( normal, 0 ) ).xyz.normalize();

			// Sample ambient light dynamically in the direction of the world normal from the environment map (IBL)
			const ambientLightColor = pmremTexture( scene.environment, worldNormal, 0.9 ).rgb.mul( 1.5 );

			// Combine direct light and ambient sky contribution (offset positionRay.y by 0.5 to keep factors positive)
			const directLight = directLightColor.mul( transmittance );
			const ambientLight = ambientLightColor.mul( positionRay.y.add( 0.5 ) ).mul( density );
			const cloudColor = directLight.add( ambientLight );

			// Front-to-back blending with accumulated color (higher opacity for solid volume appearance)
			const alpha = density.mul( stepSize ).mul( 8 );
			const colSample = cloudColor.mul( alpha );

			finalColor.rgb.addAssign( finalColor.a.oneMinus().mul( colSample ) );
			finalColor.a.addAssign( finalColor.a.oneMinus().mul( alpha ) );

			// Early loop termination if cloud gets opaque
			If( finalColor.a.greaterThanEqual( 0.95 ), () => {

				Break();

			} );

		} );

	} );

	return finalColor;

} );

// Create custom cube geometry
const geometry = new THREE.BoxGeometry( 1, 1, 1 );

// Setup material with raymarched clouds, render the back side, and enable transparency
const material = new THREE.MeshBasicNodeMaterial();
material.colorNode = raymarchClouds();
material.side = THREE.BackSide;
material.transparent = true;

// Create mesh, scale, position, disable frustum culling, and add to empty scene
const mesh = new THREE.Mesh( geometry, material );
mesh.scale.set( 4, 3, 4 );
mesh.position.y = 1.6;
mesh.frustumCulled = false;
scene.add( mesh );
```
