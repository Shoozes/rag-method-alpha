# Ternary

Different from [If-Else](#if-else), a ternary conditional will return a value and can be used outside of `Fn()`.

<code name="ternaryExample" default="true">Ternary Example</code>

::: api select( conditionNode, trueNode, falseNode )
- **conditionNode**: `Node` - TSL condition expression.
- **trueNode**: `Node` - Node or value returned if the condition is true.
- **falseNode**: `Node` - Node or value returned if the condition is false.
:::

```js
const result = select( value.greaterThan( 1 ), 1.0, value );
```
> Note: Equivalent in JavaScript should be: `value > 1 ? 1.0 : value`

```tsl ternaryExample
import 'scenes/shaderball';
import { select, time, color } from 'three/tsl';

// Alternate color based on time.sin() being greater than 0
const isPositive = time.sin().greaterThan( 0.0 );
const chromaColor = select( isPositive, color( 0x3b82f6 ), color( 0x10b981 ) );

model.material.colorNode = chromaColor;
```
