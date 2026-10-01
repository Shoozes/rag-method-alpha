# Storage Array

It is possible to create arrays that can be used in compute shaders and storage operations.

Under the hood, `instancedArray` creates a `StorageInstancedBufferAttribute`:

::: api instancedArray( array, type )
- **array**: `TypedArray | Array` - Primitive values or typed arrays to initialize the buffer.
- **type**: `string` - TSL type name (e.g. `'float'`, `'vec3'`, etc.).
:::

Under the hood, `attributeArray` creates a `StorageBufferAttribute`:

::: api attributeArray( array, type )
- **array**: `TypedArray | Array` - Primitive values or typed arrays to initialize the buffer.
- **type**: `string` - TSL type name (e.g. `'float'`, `'vec3'`, etc.).
:::

Example:

```js
const myArray = attributeArray( new Float32Array( [ 0.05, 0.1, 0.15 ] ), 'float' );
```

```tsl
import 'scenes/shaderball';
import { attributeArray, positionLocal, normalLocal, time, int, vec3 } from 'three/tsl';

// Define a palette of 6 colors in a Float32Array (r, g, b components)
const colorPalette = attributeArray( new Float32Array( [
	0.95, 0.15, 0.15, // Hot Red
	0.95, 0.45, 0.00, // Vivid Orange
	0.95, 0.85, 0.00, // Neon Yellow
	0.05, 0.85, 0.45, // Teal Green
	0.05, 0.45, 0.95, // Bright Blue
	0.75, 0.05, 0.95 // Electric Purple
] ), 'vec3' );

// Calculate the 3D distance from the center of the preview sphere (0, 1, 0)
const sphereCenter = vec3( 0.0, 1.0, 0.0 );
const distance = positionLocal.sub( sphereCenter ).length().mul( 4.0 );

// Animate concentric rings expanding outwards over time
const scroll = distance.sub( time.mul( 1.5 ) ).fract();

// Index into the color palette based on the scroll factor
const index = int( scroll.mul( 5.9 ) );
const stripeColor = colorPalette.element( index );

// Generate physical concentric ridges matching the color wave
const wave = scroll.mul( 3.14159 ).sin().pow( 4.0 ).mul( 0.025 );
model.material.positionNode = positionLocal.add( normalLocal.mul( wave ) );

// Apply the scrolling palette colors to the shaderball material
model.material.colorNode = stripeColor;
```
