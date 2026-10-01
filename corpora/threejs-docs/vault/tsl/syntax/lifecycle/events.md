# Events

TSL nodes have active CPU-side lifecycles that can execute JavaScript callbacks at specific stages of the rendering pipeline.

Events allow you to synchronize GPU shader variables with CPU calculations, update uniforms per frame or per object, and orchestrate rendering states before or after objects, materials, and render pipelines execute.

Events are registered directly inside a TSL function `Fn()` using event functions (`OnFrameUpdate`, `OnMaterialUpdate`, `OnObjectUpdate`, etc.).

<code name="eventsExample" default="true">Centralized Material Updates</code>

::: api OnFrameUpdate( callback: Function ) : EventNode - Executes a callback once per animation frame on the CPU. :::

::: api OnBeforeFrameUpdate( callback: Function ) : EventNode - Executes a callback before frame node updates begin. :::

::: api OnMaterialUpdate( callback: Function ) : EventNode - Executes a callback when the material is rendered. :::

::: api OnBeforeMaterialUpdate( callback: Function ) : EventNode - Executes a callback before the material is updated. :::

::: api OnObjectUpdate( callback: Function ) : EventNode - Executes a callback each time an individual object using the material is rendered. :::

::: api OnBeforeObjectUpdate( callback: Function ) : EventNode - Executes a callback before each individual object is rendered. :::

::: api OnAfterObjectUpdate( callback: Function ) : EventNode - Executes a callback after an individual object finishes rendering. :::

::: api OnBeforeRenderPipeline( callback: Function ) : EventNode - Executes a callback before the post-processing render pipeline starts. :::

::: api OnAfterRenderPipeline( callback: Function ) : EventNode - Executes a callback after the post-processing render pipeline completes. :::

```tsl eventsExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { uniform, Fn, OnMaterialUpdate, sin, cos, positionLocal, normalView, positionViewDirection } from 'three/tsl';

// Define a self-contained TSL shader function with encapsulated uniforms and lifecycle events
const energySphere = Fn( () => {

	// Declare uniforms inside the function
	const baseColor = uniform( new THREE.Color() );
	const glowColor = uniform( new THREE.Color() );
	const waveParams = uniform( new THREE.Vector3() ); // ( frequency, animation phase, swirl )
	const glowIntensity = uniform( 0.0 );

	// Update all material uniforms simultaneously on the CPU in a single callback
	OnMaterialUpdate( ( { time } ) => {

		const t = time * 0.7;

		// 1. Dynamic harmonic palette cycling across HSL color space
		baseColor.value.setHSL( ( t * 0.05 + 0.55 ) % 1.0, 0.9, 0.35 );
		glowColor.value.setHSL( ( t * 0.08 + 0.12 ) % 1.0, 1.0, 0.65 );

		// 2. Synchronize spatial frequency, animation phase, and ripple curvature
		waveParams.value.set(
			Math.sin( t * 1.3 ) * 3.0 + 9.0, // frequency
			t * 2.5, // phase
			Math.cos( t * 0.8 ) * 0.5 + 1.0 // swirl
		);

		// 3. Compute pulsating energy burst intensity
		glowIntensity.value = Math.pow( Math.sin( t * 2.2 ) * 0.5 + 0.5, 3.0 ) * 2.5 + 0.5;

	} );

	// 3D coordinate warping for dynamic energy bands
	const p = positionLocal.mul( waveParams.x );
	const ripple = sin( p.y.mul( waveParams.z ).add( waveParams.y ) )
		.add( cos( p.x.mul( 0.8 ).add( p.z.mul( waveParams.z ) ) ) )
		.mul( 0.5 )
		.add( 0.5 );

	// Crisp energy contour rings
	const bands = sin( ripple.mul( 12.0 ) ).pow( 4.0 );

	// Dynamic Fresnel rim lighting
	const fresnel = normalView.dot( positionViewDirection ).oneMinus().pow( 3.0 );

	// Composite multi-layered iridescent energy shading
	const core = ripple.mix( baseColor, glowColor );
	const energyGlow = glowColor.mul( bands.mul( glowIntensity ).add( fresnel.mul( 2.0 ) ) );

	return core.add( energyGlow );

} );

// Apply the reactive event shader to the material
model.material.colorNode = energySphere();
model.material.roughness = 0.2;
model.material.metalness = 0.9;
```
