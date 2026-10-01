# Loop

This module offers a variety of ways to implement loops in TSL.

<code name="fractalExample" default="true">Fractal Loop Example</code>

::: api Loop( count/config, callback )
- **count/config**: `number | object` - Either the iteration count (e.g. `5`), or a configuration object (e.g. `{ start, end, type, condition, name }`).
- **callback**: `Function` - Loop body callback function, receiving index variables destructured (e.g. `( { i } ) => {}`).
:::

In its basic form:

```js
Loop( count, ( { i } ) => {

} );
```

However, it is also possible to define start and end ranges, data types, and loop conditions:

```js
Loop( { start: int( 0 ), end: int( 10 ), type: 'int', condition: '<', name: 'i' }, ( { i } ) => {

} );
```

Nested loops can be defined in a compacted form:

```js
Loop( 10, 5, ( { i, j } ) => {

} );
```

Loops that should run backwards can be defined like so:

```js
Loop( { start: 10 }, () => {} );
```

It is possible to execute with boolean values, similar to the `while` syntax:

```js
const value = float( 0 );

Loop( value.lessThan( 10 ), () => {

	value.addAssign( 1 );

} );
```

The module also provides `Break()` and `Continue()` TSL expressions for loop control.

```tsl fractalExample
import 'scenes/empty';
import { Fn, float, Loop, screenUV, color, time, vec2, If, Break } from 'three/tsl';

const julia = Fn( () => {

	// Scale and center screen UV coordinates
	const z = screenUV.sub( 0.5 ).mul( 3.0 );

	// Animate the complex constant c over time
	const c = vec2( time.cos().mul( 0.3 ).sub( 0.7 ), time.sin().mul( 0.2 ).add( 0.27015 ) );
	const iterations = float( 0.0 );

	// Loop 32 times to calculate the fractal escape depth
	Loop( 32, ( { i } ) => {

		// Complex number square: z = z^2 + c
		const x = z.x.mul( z.x ).sub( z.y.mul( z.y ) );
		const y = z.x.mul( z.y ).mul( 2.0 );
		z.assign( vec2( x, y ).add( c ) );

		// Break early if the point escapes the threshold
		If( z.length().greaterThan( 2.0 ), () => {

			iterations.assign( i.toFloat() );
			Break();

		} );

	} );

	// Return normalized value based on loop iterations
	return iterations.div( 32.0 );

} );

const fractalVal = julia();

// Assign the procedural fractal directly to renderPipeline
renderPipeline.outputNode = fractalVal.mix( color( 0x050510 ), color( 0x3b82f6 ) ).add( fractalVal.pow( 2.0 ).mul( color( 0x10b981 ) ) );
```
