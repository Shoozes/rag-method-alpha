# Builtin Context

TSL provides pre-built context helpers such as **`builtinAOContext()`** and **`builtinShadowContext()`** to quickly modify ambient occlusion and lighting shadow behavior across a material or node sub-graph without manually writing custom `getAO` or `getShadow` context handler objects.

::: api builtinAOContext( aoNode, node = null ) : ContextNode - Intercepts `getAO` to modulate ambient occlusion for non-transparent materials by `aoNode`.
- **aoNode**: `Node` - The ambient occlusion node to multiply.
- **node**: `Node` - Optional node expression to wrap with this AO context. Defaults to `null`.
:::

::: api .builtinAOContext( aoNode ) : ContextNode - Method chaining helper to wrap the current node expression with a built-in AO context. :::

::: api builtinShadowContext( shadowNode, light, node = null ) : ContextNode - Intercepts `getShadow` to modulate the shadow color of a specific light by `shadowNode`.
- **shadowNode**: `Node` - The shadow modulation node.
- **light**: `Light` - The target light whose shadow should be modulated.
- **node**: `Node` - Optional node expression to wrap with this shadow context. Defaults to `null`.
:::

::: api .builtinShadowContext( shadowNode, light ) : ContextNode - Method chaining helper to wrap the current node expression with a built-in shadow context. :::

### Example

```js
import { builtinAOContext } from 'three/tsl';

// Modulate global ambient occlusion and shadow for the material
myPass.contextNode = builtinAOContext( screenSpaceAO ).builtinShadowContext( screenSpaceShadow, dirLight );
```
