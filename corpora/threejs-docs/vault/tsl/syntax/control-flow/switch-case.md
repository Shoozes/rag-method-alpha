# Switch-Case

A Switch-Case statement is an alternative way to express conditional logic compared to [If-Else](#if-else).

> Important: TSL conditionals must be defined inside a TSL function `Fn()` because they rely on the function's execution stack to build conditional shader branches.

> Note: Notice here `Switch`, `Case` and `Default` are capitalized.

```js
const col = color();

Switch( selector )
	.Case( 0, () => {

		col.assign( color( 1, 0, 0 ) );

	} ).Case( 1, () => {

		col.assign( color( 0, 1, 0 ) );

	} ).Case( 2, 3, () => {

		col.assign( color( 0, 0, 1 ) );

	} ).Default( () => {

		col.assign( color( 1, 1, 1 ) );

	} );
```

Notice that there are some rules when using this syntax which differentiate TSL from JavaScript:

- There is no fallthrough support. So each `Case()` statement has an implicit break.
- A `Case()` statement can hold multiple values (selectors) for testing.

```tsl
import 'scenes/shaderball';
import { Fn, color, time, int, Switch } from 'three/tsl';

const selectColor = Fn( () => {

	const col = color();

	// Cycle selector 0, 1, 2, 3 based on elapsed time
	const selector = int( time.mul( 1.5 ).mod( 4 ) );

	Switch( selector )
		.Case( 0, () => {

			col.assign( color( 1, 0, 0 ) ); // Red

		} )
		.Case( 1, () => {

			col.assign( color( 0, 1, 0 ) ); // Green

		} )
		.Case( 2, 3, () => {

			col.assign( color( 0, 0, 1 ) ); // Blue

		} )
		.Default( () => {

			col.assign( color( 1, 1, 1 ) ); // White

		} );

	return col;

} );

model.material.colorNode = selectColor();
```
