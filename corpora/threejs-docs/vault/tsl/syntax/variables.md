# Variables

TSL allows creating explicit shader variables and constants to store intermediate calculation results, assist in debugging, or optimize shader graphs manually.

### Chainable Methods

::: api .toVar( name? )
- **name**: `string` - (Optional) Name of the variable in the shader. Defaults to `null`.
:::

::: api .toConst( name? )
- **name**: `string` - (Optional) Name of the constant in the shader. Defaults to `null`.
:::

### Var and Const

Direct functions create variables or constants explicitly by taking a TSL node as their first argument.

> Note: Notice here `Var` and `Const` are capitalized.

::: api Var( node, name? )
- **node**: `Node` - TSL node or expression to initialize the variable with.
- **name**: `string` - (Optional) Name of the variable in the shader. Defaults to `null`.
:::

<code name="varyingPropertyExample">Varying property example</code>

::: api Const( node, name? )
- **node**: `Node` - TSL node or expression to initialize the constant with.
- **name**: `string` - (Optional) Name of the constant in the shader. Defaults to `null`.
:::

The name is optional; if set to `null`, the node system will generate one automatically.

Creating a variable or constant can help optimize the shader graph manually or assist in debugging.

```tsl
import 'scenes/shaderball';
import * as THREE from 'three';
import { texture, uv } from 'three/tsl';

// Load texture
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

// Create a variable in TSL
// .debug() will show the node in the console
const uvScaled = uv().mul( 5 ).toVar( 'myVar' ).debug();

// Sample the texture using the scaled UV variable
model.material.colorNode = texture( map, uvScaled );
```

> IA: When the `NodeBuilder` encounters issues generating the optimal shader structure or variable optimizations, `.toVar()` can help by explicitly declaring a variable in the shader scope rather than relying on automatic generation. While not recommended for common use (since TSL manages variables automatically), it is an effective tool for debugging: you can assign a custom name like `.toVar( 'debugVal' )` and inspect the generated variable directly in the compiled WGSL / GLSL output.
