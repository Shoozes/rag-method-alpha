# Screen

Screen nodes return values related to the current frame buffer, either normalized or in physical pixel units considering the current device pixel ratio (DPR).

<code name="screenExample" default="true">Screen-Space Projection</code>

::: api screenUV : vec2 - Returns the normalized frame buffer coordinate. :::

::: api screenCoordinate : vec2 - Returns the frame buffer coordinate in physical pixel units. :::

::: api screenSize : vec2 - Returns the frame buffer size in physical pixel units. :::

::: api screenDPR : float - Returns the device pixel ratio (DPR). :::

```tsl screenExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { screenUV, texture } from 'three/tsl';

// Load a test grid texture and disable flipY on the texture instance
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.flipY = false;

// Project the texture directly onto screen-space coordinates
// The texture will appear completely fixed to the 2D screen as you orbit or pan the camera!
model.material.colorNode = texture( map, screenUV );
```
