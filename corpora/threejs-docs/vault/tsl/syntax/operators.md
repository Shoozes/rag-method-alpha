# Operators

TSL nodes support all standard mathematical, logical, and bitwise operators as chainable methods:

::: api .add( ...value: Node | number ) : Node - Return the addition of two or more values. :::

::: api .sub( value: Node | number ) : Node - Return the subtraction of two or more values. :::

::: api .mul( value: Node | number ) : Node - Return the multiplication of two or more values. :::

::: api .div( value: Node | number ) : Node - Return the division of two or more values. :::

::: api .mod( value: Node | number ) : Node - Computes the remainder of dividing the first node by the second. :::

::: api .equal( value: Node | number | boolean ) : bool - Checks if two nodes are equal. :::

::: api .notEqual( value: Node | number | boolean ) : bool - Checks if two nodes are not equal. :::

::: api .lessThan( value: Node | number | boolean ) : bool - Checks if the first node is less than the second. :::

::: api .greaterThan( value: Node | number | boolean ) : bool - Checks if the first node is greater than the second. :::

::: api .lessThanEqual( value: Node | number | boolean ) : bool - Checks if the first node is less than or equal to the second. :::

::: api .greaterThanEqual( value: Node | number | boolean ) : bool - Checks if the first node is greater than or equal to the second. :::

::: api .and( value: Node | boolean ) : bool - Performs logical AND on two nodes. :::

::: api .or( value: Node | boolean ) : bool - Performs logical OR on two nodes. :::

::: api .not( value: Node | boolean ) : bool - Performs logical NOT on a node. :::

::: api .xor( value: Node | boolean ) : bool - Performs logical XOR on two nodes. :::

::: api .bitAnd( value: Node | number ) : Node - Performs bitwise AND on two nodes. :::

::: api .bitNot( value: Node | number ) : Node - Performs bitwise NOT on a node. :::

::: api .bitOr( value: Node | number ) : Node - Performs bitwise OR on two nodes. :::

::: api .bitXor( value: Node | number ) : Node - Performs bitwise XOR on two nodes. :::

::: api .shiftLeft( value: Node | number ) : Node - Shifts a node to the left. :::

::: api .shiftRight( value: Node | number ) : Node - Shifts a node to the right. :::

```tsl
import 'scenes/shaderball';
import { color } from 'three/tsl';

// simple color manipulation using operators
const red = color( 1.0, 0.0, 0.0 );
const blue = color( 0.0, 0.0, 1.0 );

// Mix the two colors using add and mul operators
const mixedColor = red.mul( 0.5 ).add( blue.mul( 0.5 ) ); // results in purple!

model.material.colorNode = mixedColor;
```
