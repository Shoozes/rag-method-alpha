# Normal

Normal nodes provide access to surface direction vectors at different transformation stages. In TSL, these values are mapped to specific [Coordinate Spaces](#coordinate-spaces) (Geometry, Local, World, or View) to allow precise control over lighting, reflections, and normal mapping.

::: api normalGeometry : vec3 - Normal attribute of geometry. :::

::: api normalLocal : vec3 - Local variable for normal. :::

::: api normalView : vec3 - Normalized transformed view normal. :::

::: api normalViewGeometry : vec3 - Normalized view normal. :::

::: api normalWorld : vec3 - Normalized transformed world normal. :::

::: api normalWorldGeometry : vec3 - Normalized world normal. :::

> Note: The transformed term here also includes following the correct orientation of the face, so that the normals are inverted inside the geometry.

```tsl
import 'scenes/shaderball';
import * as THREE from 'three';
import { normalView, positionViewDirection, color } from 'three/tsl';

// Calculate X-ray factor (opaque at edges, transparent in the center)
const viewDot = normalView.dot( positionViewDirection ).clamp();
const xray = viewDot.oneMinus().pow( 2.0 );

// Assign glowing cyan color and map the X-ray factor to the opacity
model.material.colorNode = color( 0x00f3ff );
model.material.opacityNode = xray;
model.material.transparent = true;
model.material.side = THREE.DoubleSide;
```
