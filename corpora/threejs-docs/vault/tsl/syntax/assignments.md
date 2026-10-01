# Assignments

TSL variables and parameters inside a custom function `Fn` can be updated dynamically using assignment methods:
::: api .assign( value: Node | number ) : Node - Assigns a value and returns the node. :::

::: api .addAssign( value: Node | number ) : Node - Adds a value and assigns the result. :::

::: api .subAssign( value: Node | number ) : Node - Subtracts a value and assigns the result. :::

::: api .mulAssign( value: Node | number ) : Node - Multiplies a value and assigns the result. :::

::: api .divAssign( value: Node | number ) : Node - Divides a value and assigns the result. :::

::: api .modAssign( value: Node | number ) : Node - Computes the remainder and assigns the result. :::

::: api .bitAndAssign( value: Node | number ) : Node - Performs bitwise AND and assigns the result. :::

::: api .bitOrAssign( value: Node | number ) : Node - Performs bitwise OR and assigns the result. :::

::: api .bitXorAssign( value: Node | number ) : Node - Performs bitwise XOR and assigns the result. :::

::: api .shiftLeftAssign( value: Node | number ) : Node - Shifts left and assigns the result. :::

::: api .shiftRightAssign( value: Node | number ) : Node - Shifts right and assigns the result. :::

```tsl
import 'scenes/shaderball';
import { Fn, vec3 } from 'three/tsl';

// A TSL Fn where arguments act as mutable variables
const modifyColor = Fn( ( [ color ] ) => {

	// Add blue to the incoming color node directly
	color.addAssign( vec3( 0.0, 0.0, 1.0 ) );

	return color;

} );

const baseColor = vec3( 0.0, 1.0, 0.0 ); // Green

model.material.colorNode = modifyColor( baseColor ); // Becomes Cyan
```
