# Lights

In Three.js WebGPU and TSL, lighting is fully node-based. Scene lights (such as `DirectionalLight`, `PointLight`, `SpotLight`, `HemisphereLight`, `AmbientLight`, and `RectAreaLight`) are automatically converted into analytic light node graphs that evaluate direct and indirect lighting terms during shader compilation.

The lighting pipeline is orchestrated through two core components:
- **`LightsNode`**: Collects scene lights and calculates the total outgoing diffuse (`totalDiffuse`) and specular (`totalSpecular`) illumination.
- **`LightingContextNode`**: Provides runtime lighting context (`reflectedLight` with `directDiffuse`, `directSpecular`, `indirectDiffuse`, `indirectSpecular`) to the active `LightingModel` (Standard, Physical, Phong, Lambert, Toon).

You can decouple an individual material from global scene lights by assigning a custom `lights( [ ... ] )` node to `material.lightsNode`.

<code name="tslLightingSystem" default="true">TSL Lighting System</code>

::: api lights( lights: Array<Light> = [] ) : LightsNode - Creates a lighting node that manages a specific set of lights and their shadow evaluations.
- **lights**: `Array<Light>` - (Optional) Array of Three.js light instances to include in the lighting group.
:::

::: api material.lightsNode : LightsNode - Property on NodeMaterial to override or isolate the lights illuminating the material. :::

::: api lightingContext( lightsNode: LightsNode, lightingModel: LightingModel = null ) : LightingContextNode - Wraps lighting execution within a custom lights node and optional lighting model.
- **lightsNode**: `LightsNode` - The target lights node to evaluate.
- **lightingModel**: `LightingModel` - (Optional) Custom lighting model (e.g. Lambert, Phong, Standard, Physical, Toon).
:::

```tsl tslLightingSystem
import 'scenes/shaderball';
import * as THREE from 'three';
import { lights, color } from 'three/tsl';

// 1. Create distinct scene lights
const keyLight = new THREE.PointLight( 0x00d4ff, 80, 10 );
const rimLight = new THREE.PointLight( 0xff0066, 120, 10 );

scene.add( keyLight );
scene.add( rimLight );

// 2. Isolate lighting on the model using a custom lights node
model.material.lightsNode = lights( [ keyLight, rimLight ] );

model.material.colorNode = color( 0xffffff );
model.material.roughness = 0.2;
model.material.metalness = 0.6;

// 3. Animate orbiting lights in world space
export function update() {

	const t = performance.now() * 0.0015;

	keyLight.position.set( Math.cos( t ) * 3.0, 2.0, Math.sin( t ) * 3.0 );
	rimLight.position.set( Math.cos( t + Math.PI ) * 3.5, 1.5, Math.sin( t + Math.PI ) * 3.5 );

}
```

### Lights API Reference

| API | Type | Description |
| :--- | :--- | :--- |
| `lights( lightsArray )` | Function | Creates a `LightsNode` containing a designated array of lights. |
| `material.lightsNode` | Property | Per-material override for scene light sources. |
| `lightingContext( lightsNode, model )` | Function | Wraps lighting computation within a custom lights node and lighting model. |

#### Related
- [Light Functions](#light-functions)
- [Shadows](#shadows)
- [Projector Light](#projector-light)
- [Material Inputs](#material-inputs)
