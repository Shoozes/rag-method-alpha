# Vertex Stage and Varying

Functions and methods used to optimize computations by moving them to the vertex shader stage and passing them as interpolated variables to the fragment shader stage.

<code name="vertexStageExample" default="true">Vertex stage example</code>
<code name="varyingExample">Varying example</code>

### Vertex Stage

::: api vertexStage( node )
- **node**: `Node` - TSL expression to compute on the vertex stage.
:::

::: api .toVertexStage() - Chainable method to convert any existing node or expression directly into a vertex-stage calculation. :::

The `vertexStage()` function forces a calculation to be performed in the vertex stage of the GPU pipeline, rather than in the fragment stage. This is useful for optimizing expensive operations by performing them per-vertex and interpolating the results.

Example:

```js
// Multiplication will be executed in vertex stage
const normalView = modelNormalMatrix.mul( normalLocal ).toVertexStage();

// Normalize will be computed in fragment stage
material.colorNode = normalView.normalize();
```

### Varying

Similarly to `vertexStage()`, `varying()` function forces a calculation to be performed in the vertex stage of the GPU pipeline, but it also declares a named varying variable.

::: api varying( node, name? )
- **node**: `Node` - TSL expression to compute in the vertex stage and pass to the fragment stage.
- **name**: `string` - (Optional) Custom name for the varying variable. Defaults to `null`.
:::

::: api .toVarying( name? ) - Chainable method to convert any existing node or expression directly into a varying variable.
- **name**: `string` - (Optional) Custom name for the varying variable. Defaults to `null`.
:::

If `varying()` is added only to `material.positionNode`, it will only return a simple variable and a varying will not be created because `material.positionNode` is computed at the vertex stage.

```tsl vertexStageExample
import 'scenes/shaderball';
import { modelNormalMatrix, normalLocal } from 'three/tsl';

// Using .toVertexStage() chainable method syntax
const normalView = modelNormalMatrix.mul( normalLocal ).toVertexStage();

// Normalization is interpolated and computed in the fragment stage
model.material.colorNode = normalView.normalize();
```

```tsl varyingExample
import 'scenes/shaderball';
import { uv } from 'three/tsl';

// Using .toVarying() chainable method syntax
const myVaryingUv = uv().mul( 10.0 ).toVarying( 'vScaledUv' );

// Sample colors in the fragment shader using sine wave of the varying UV
model.material.colorNode = myVaryingUv.sin();
```

#### Related
  - [Properties](#properties)
