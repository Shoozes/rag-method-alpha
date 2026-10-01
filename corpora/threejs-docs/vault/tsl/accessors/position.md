# Position

Position nodes provide access to the coordinates of vertices or fragments at different transformation stages. In TSL, these values are mapped to specific [Coordinate Spaces](#coordinate-spaces) (Geometry, Local, World, or View) to allow precise control over vertex displacement, morphing, and view-dependent effects.

<code name="positionExample" default="true">Local vs World fSpace</code>

::: api positionGeometry : vec3 - Position attribute of geometry. :::

::: api positionLocal : vec3 - Transformed local position. :::

::: api positionWorld : vec3 - Transformed world position. :::

::: api positionWorldDirection : vec3 - Normalized world direction. :::

::: api positionView : vec3 - View position. :::

::: api positionViewDirection : vec3 - Normalized view direction. :::

> Note: The transformed term reflects the modifications applied by processes such as **skinning**, **morphing**, and similar techniques.

```tsl positionExample
import 'scenes/shaderball';
import { positionLocal, positionWorld, Fn, float, fract, abs, fwidth, max, saturate, color } from 'three/tsl';

// Simple 3D grid generator
const grid = Fn( ( [ pos ] ) => {

	const scale = pos.mul( 8.0 );
	const g = fract( scale );
	const fw = fwidth( scale );
	const dist = abs( g.sub( 0.5 ) );
	const line = saturate( float( 0.05 ).sub( dist ).div( fw ).add( 0.5 ) );
	return max( line.x, line.y, line.z );

} );

// Split the model: Left side uses positionLocal, Right side uses positionWorld
const isRightSide = positionWorld.x.greaterThan( 0.0 );
const coords = isRightSide.select( positionWorld, positionLocal );

// Render the grid: the left side rotates, the right side stays static in space!
const gridLines = grid( coords );
const stripeColor = isRightSide.select( color( 0x06b6d4 ), color( 0xec4899 ) ); // Cyan (World) vs Pink (Local)

model.material.colorNode = gridLines.mix( color( 0x1f2937 ), stripeColor );
```
