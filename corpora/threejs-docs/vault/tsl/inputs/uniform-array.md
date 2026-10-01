# Uniform Array

It is possible to use the same [Array](#array) logic for uniforms using Three.js native components or primitive values.

::: api uniformArray( values, type? )
- **values**: `Array` - Array of initial values (e.g. `Color`, `Vector3`, numbers, etc.).
- **type**: `string` - (Optional) Explicit TSL type name (e.g. `'color'`, `'vec3'`, etc.). Defaults to `null`.
:::

Example:

```js
const tintColors = uniformArray( [
	new Color( 1, 0, 0 ),
	new Color( 0, 1, 0 ),
	new Color( 0, 0, 1 )
] );

const redColor = tintColors.element( 0 );
```

```tsl
import 'scenes/shaderball';
import * as THREE from 'three';
import { uniformArray, int, time } from 'three/tsl';

// Define a uniform array of Colors using THREE.Color
const tintColors = uniformArray( [
	new THREE.Color( 1, 0, 0 ), // Red
	new THREE.Color( 0, 1, 0 ), // Green
	new THREE.Color( 0, 0, 1 ) // Blue
] );

// Dynamically select the element index based on time
const index = int( time.mul( 1.5 ).mod( 3 ) );

// Apply the selected color to the sphere
model.material.colorNode = tintColors.element( index );
```
