# If-Else

TSL's `If` builds dynamic conditional branches that execute directly on the GPU (per-vertex or per-pixel). This differs from standard JavaScript `if` statements, which only run once on the CPU during the shader construction phase.

> Important: TSL conditionals must be defined inside a TSL function `Fn()` because they rely on the function's execution stack to build conditional shader branches.

> Note: Notice here `If`, `ElseIf`, `Else` are capitalized.

```js
If( conditional, () => {

	// Do something...

} ).ElseIf( conditional, () => {

	// Do something else...

} ).Else( () => {

	// Do something else...

} );
```

```tsl
import 'scenes/shaderball';
import { Fn, float, color, vec3, time, positionLocal, If } from 'three/tsl';

const limitPosition = Fn( ( { position } ) => {

	const limit = float( time.sin().abs() );
	const result = vec3( position );

	If( result.y.greaterThan( limit ), () => {

		result.y = limit;

	} ).ElseIf( result.y.lessThan( limit.negate() ), () => {

		result.y = limit.negate();

	} );

	return result;

} );

model.material.colorNode = color( 0x1e90ff );
model.material.positionNode = limitPosition( positionLocal );
```
