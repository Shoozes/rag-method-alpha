# Array

The `array()` function in TSL allows creating constant or dynamic value arrays; there are many ways to create arrays in TSL.

::: api array( array, type? ) : Node - Creates an array node.
- **array**: `Array` - Array of initial values (e.g. `Color`, `Vector3`, numbers, etc.).
- **type**: `string` - (Optional) TSL type name (e.g. `'float'`, `'vec3'`, etc.).
:::

To access the values you can use `a[ 1 ]` or `a.element( 1 )`. The difference is that `a[ 1 ]` only allows constant values, while `a.element( 1 )` allows the use of dynamic values such as `a.element( index )` where index is a node.

```js
const colors = array( [
	vec3( 1, 0, 0 ),
	vec3( 0, 1, 0 ),
	vec3( 0, 0, 1 )
] );

const greenColor = colors.element( 1 ); // vec3( 0, 1, 0 )
```

Define an array type explicitly:

```js
const a = array( [ 0, 1, 2 ], 'uint' );
const value = a.element( 1 ); // 1u
```

Array fixed size:

```js
const a = array( 'vec3', 2 ); // [ vec3( 0, 0, 0 ), vec3( 0, 0, 0 ) ]
```

Fill an array with a default value:

```js
const a = vec3( 0, 0, 1 ).toArray( 2 ); // [ vec3( 0, 0, 1 ), vec3( 0, 0, 1 ) ]
```

```tsl
import 'scenes/shaderball';
import { array, vec3, int, time } from 'three/tsl';

// Define a constant array of colors in TSL
const colors = array( [
	vec3( 1, 0, 0 ), // Red
	vec3( 0, 1, 0 ), // Green
	vec3( 0, 0, 1 ) // Blue
] );

// Dynamically cycle the index from 0 to 2 using time
const index = int( time.mul( 1.5 ).mod( 3 ) );

// Select the color from the array
const activeColor = colors.element( index );

model.material.colorNode = activeColor;
```
