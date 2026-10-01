# Model

Model nodes provide access to the object's transformation matrices, scale, position, and orientation properties. These are crucial for converting coordinates from local to world space, and adjusting material properties dynamically based on the object's physical transform in the scene.

<code name="modelExample" default="true">Pulsing Energy Ripples</code>

::: api modelDirection : vec3 - Direction of the model. :::

::: api modelViewMatrix : mat4 - View-space matrix of the model. :::

::: api modelNormalMatrix : mat3 - View-space matrix of the model. :::

::: api modelWorldMatrix : mat4 - World-space matrix of the model. :::

::: api modelPosition : vec3 - Position of the model. :::

::: api modelScale : vec3 - Scale of the model. :::

::: api modelViewPosition : vec3 - View-space position of the model. :::

::: api modelWorldMatrixInverse : mat4 - Inverse world matrix of the model. :::

::: api highpModelViewMatrix : mat4 - View-space matrix of the model computed on CPU using 64-bit. :::

::: api highpModelNormalViewMatrix : mat3 - View-space normal matrix of the model computed on CPU using 64-bit. :::

```tsl modelExample
import 'scenes/shaderball';
import { positionWorld, modelPosition, time, color } from 'three/tsl';

// Calculate the world-space vector from the model's center pivot
const localOffset = positionWorld.sub( modelPosition );

// Get the distance from the center of the model
const distance = localOffset.length();

// Create animated concentric wave ripples expanding from the model's center
const wave = distance.sub( time.mul( .3 ) ).mul( 7.0 );
const ripple = wave.sin().abs().oneMinus().pow( 3.0 ); // Soft, high-contrast glow bands

// Mix a sleek dark metallic blue with glowing neon energy ripples
model.material.colorNode = ripple.mix( color( 0x050c18 ), color( 0xffaa00 ) );
```
