# Camera

Camera nodes provide access to the active camera's parameters, transformation matrices, and spatial orientation properties. These are crucial for depth-based calculations, projection transformations, and screen-space coordinates.

<code name="cameraExample" default="true">Dithering Dissolve</code>

::: api cameraNear : float - Near plane distance of the camera. :::

::: api cameraFar : float - Far plane distance of the camera. :::

::: api cameraProjectionMatrix : mat4 - Projection matrix of the camera. :::

::: api cameraProjectionMatrixInverse : mat4 - Inverse projection matrix of the camera. :::

::: api cameraViewMatrix : mat4 - View matrix of the camera. :::

::: api cameraWorldMatrix : mat4 - World matrix of the camera. :::

::: api cameraNormalMatrix : mat3 - Normal matrix of the camera. :::

::: api cameraPosition : vec3 - World position of the camera. :::

```tsl cameraExample
import 'scenes/shaderball';
import { cameraPosition, positionWorld, viewportCoordinate, color, float } from 'three/tsl';

// 1. Calculate the distance from the camera to the surface
const distanceToCamera = cameraPosition.distance( positionWorld );

// 2. Define a dissolve threshold that increases (from 0 to 1) as the camera gets closer
// It starts dissolving at 5.0 units away, and is completely dissolved at 1.5 units.
const dissolveStart = float( 5.0 );
const dissolveEnd = float( 1.5 );
const threshold = dissolveStart.sub( distanceToCamera ).div( dissolveStart.sub( dissolveEnd ) ).clamp( 0.0, 1.0 );

// 3. Generate a screen-space pseudo-random dither threshold based on pixel coordinates
const pixelCoords = viewportCoordinate.floor();
const ditherVal = pixelCoords.x.mul( 12.9898 ).add( pixelCoords.y.mul( 78.233 ) ).sin().mul( 43758.5453 ).fract();

// 4. Assign the dither comparison as the material's maskNode (true to keep, false to discard)
model.material.maskNode = ditherVal.greaterThanEqual( threshold );

// Set a glowing orange color
model.material.colorNode = color( 0xff5500 );
```
