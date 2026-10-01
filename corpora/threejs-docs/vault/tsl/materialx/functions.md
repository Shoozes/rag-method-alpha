# Functions

MaterialX standard helper functions for procedural ramps, anti-aliased transitions, 2D and 3D spatial transformations, normal reconstruction, and math operations.

::: api mx_aastep( threshold, value ) : float - Anti-aliased step function using screen derivatives (`dFdx`, `dFdy`) to eliminate sub-pixel aliasing and jagged edges.
- **threshold**: `Node | float | number` - Step threshold boundary.
- **value**: `Node | float | number` - Input value evaluated against threshold.
:::

::: api mx_ramplr( valuel, valuer, texcoord? ) : Node - Linear horizontal ramp interpolating from `valuel` at `u=0` to `valuer` at `u=1`.
- **valuel**: `Node | Color | number` - Left value at `u = 0`.
- **valuer**: `Node | Color | number` - Right value at `u = 1`.
- **texcoord**: `vec2` - (Optional) UV coordinates. Defaults to `uv()`.
:::

::: api mx_ramptb( valueb, valuet, texcoord? ) : Node - Linear vertical ramp interpolating from `valueb` at `v=0` to `valuet` at `v=1`.
- **valueb**: `Node | Color | number` - Bottom value at `v = 0`.
- **valuet**: `Node | Color | number` - Top value at `v = 1`.
- **texcoord**: `vec2` - (Optional) UV coordinates. Defaults to `uv()`.
:::

::: api mx_ramp4( valuetl, valuetr, valuebl, valuebr, texcoord? ) : Node - Bilinear 4-corner ramp interpolating four corner values across UV space.
- **valuetl**: `Node | Color | number` - Top-Left value `(0, 1)`.
- **valuetr**: `Node | Color | number` - Top-Right value `(1, 1)`.
- **valuebl**: `Node | Color | number` - Bottom-Left value `(0, 0)`.
- **valuebr**: `Node | Color | number` - Bottom-Right value `(1, 0)`.
- **texcoord**: `vec2` - (Optional) UV coordinates. Defaults to `uv()`.
:::

::: api mx_splitlr( valuel, valuer, center?, texcoord? ) : Node - Anti-aliased horizontal step splitting `valuel` and `valuer` at `center`.
- **valuel**: `Node | Color | number` - Left value.
- **valuer**: `Node | Color | number` - Right value.
- **center**: `Node | float | number` - Split coordinate threshold. Defaults to `0.5`.
- **texcoord**: `vec2` - (Optional) UV coordinates. Defaults to `uv()`.
:::

::: api mx_splittb( valueb, valuet, center?, texcoord? ) : Node - Anti-aliased vertical step splitting `valueb` and `valuet` at `center`.
- **valueb**: `Node | Color | number` - Bottom value.
- **valuet**: `Node | Color | number` - Top value.
- **center**: `Node | float | number` - Split coordinate threshold. Defaults to `0.5`.
- **texcoord**: `vec2` - (Optional) UV coordinates. Defaults to `uv()`.
:::

::: api mx_transform_uv( uv_scale?, uv_offset?, uv_geo? ) : vec2 - Scales and offsets 2D UV texture coordinates.
- **uv_scale**: `Node | vec2 | number` - Scale factor. Defaults to `1`.
- **uv_offset**: `Node | vec2 | number` - Translation offset. Defaults to `0`.
- **uv_geo**: `vec2` - Base UV coordinates. Defaults to `uv()`.
:::

::: api mx_place2d( texcoord, pivot?, scale?, rotate?, offset?, operationorder? ) : vec2 - Full 2D texture coordinate placement matrix transformation.
- **texcoord**: `vec2` - Base UV coordinates.
- **pivot**: `vec2` - Center pivot point. Defaults to `vec2(0, 0)`.
- **scale**: `vec2` - Coordinate scale factors `(u, v)`. Defaults to `vec2(1, 1)`.
- **rotate**: `float | number` - Rotation angle in degrees. Defaults to `0`.
- **offset**: `vec2` - Translation offset vector. Defaults to `vec2(0, 0)`.
- **operationorder**: `int | number` - Transformation order: `0: SRT` (Scale, Rotate, Translate), `1: TRS` (Translate, Rotate, Scale). Defaults to `0`.
:::

::: api mx_rotate2d( input, amount? ) : vec2 - Rotates a 2D vector by `amount` degrees around the origin.
- **input**: `vec2` - Vector to rotate.
- **amount**: `float | number` - Rotation angle in degrees. Defaults to `0`.
:::

::: api mx_rotate3d( input, amount?, axis? ) : vec3 - Rotates a 3D vector around an arbitrary 3D axis by `amount` degrees using Rodrigues' rotation formula.
- **input**: `vec3` - 3D vector or position to rotate.
- **amount**: `float | number` - Rotation angle in degrees. Defaults to `0`.
- **axis**: `vec3` - Rotation axis vector (automatically normalized). Defaults to `vec3(0, 1, 0)`.
:::

::: api mx_heighttonormal( input, scale?, texcoord? ) : vec3 - Reconstructs tangent-space surface normal vectors from a scalar procedural height field using Sobel screen/UV partial derivatives.
- **input**: `Node | float` - Scalar height input node.
- **scale**: `float | number` - Bump/height strength scale factor. Defaults to `1`.
- **texcoord**: `vec2` - Texture coordinate node. Defaults to `uv()`.
:::

::: api mx_safepower( in1, in2? ) : Node - Computes `sign(in1) * |in1|^in2`, safely preserving sign without NaN errors on negative inputs.
- **in1**: `Node | float` - Base input value.
- **in2**: `Node | float | number` - Exponent. Defaults to `1`.
:::

::: api mx_contrast( input, amount?, pivot? ) : Node - Adjusts contrast around a midpoint pivot.
- **input**: `Node | float | vec3` - Input value or color.
- **amount**: `float | number` - Contrast multiplier factor. Defaults to `1`.
- **pivot**: `float | number` - Center pivot value. Defaults to `0.5`.
:::

::: api mx_smoothstep( inNode, low?, high? ) : Node - Hermite smoothstep interpolation with safe fallback to prevent zero-range division artifacts.
- **inNode**: `Node | float` - Input value.
- **low**: `Node | float | number` - Lower bound. Defaults to `0`.
- **high**: `Node | float | number` - Upper bound. Defaults to `1`.
:::
