# Math

TSL provides all standard mathematical constants and functions as both direct functions and chainable methods:

### Constants

::: api EPSILON : float - Small floating-point precision value `1e-6`. :::

::: api INFINITY : float - Represents positive infinity. :::

::: api PI : float - Mathematical constant π `3.141592653589793`. :::

::: api TWO_PI : float - Two times π `6.283185307179586`. :::

::: api HALF_PI : float - Half of π `1.5707963267948966`. :::

### Functions

::: api abs( x ) : Node - Computes the absolute value of `x`.
- **x**: `Node | number` - Input value or node.
:::

::: api acos( x ) : Node - Computes the arccosine of `x` in radians.
- **x**: `Node | number` - Input value or node in range `[-1, 1]`.
:::

::: api all( x ) : bool - Returns `true` if all components of `x` are non-zero or true.
- **x**: `Node` - Vector node.
:::

::: api any( x ) : bool - Returns `true` if any component of `x` is non-zero or true.
- **x**: `Node` - Vector node.
:::

::: api asin( x ) : Node - Computes the arcsine of `x` in radians.
- **x**: `Node | number` - Input value or node in range `[-1, 1]`.
:::

::: api atan( y, x? ) : Node - Computes the arc-tangent of `y` or `y / x` in radians.
- **y**: `Node | number` - Y coordinate or single tangent ratio.
- **x**: `Node | number` - (Optional) X coordinate for two-argument arc-tangent (`atan2`).
:::

::: api bitcast( x, type ) : Node - Reinterprets the bit pattern of `x` as a different type without type conversion.
- **x**: `Node` - Input node.
- **type**: `string` - Target primitive type name (e.g. `'float'`, `'int'`, `'uint'`).
:::

::: api cbrt( x ) : Node - Computes the cube root of `x`.
- **x**: `Node | number` - Input value or node.
:::

::: api ceil( x ) : Node - Rounds `x` up to the nearest integer.
- **x**: `Node | number` - Input value or node.
:::

::: api clamp( x, min, max ) : Node - Constrains `x` to lie between `min` and `max`.
- **x**: `Node | number` - Value to constrain.
- **min**: `Node | number` - Lower bound.
- **max**: `Node | number` - Upper bound.
:::

::: api cos( x ) : Node - Computes the cosine of `x`.
- **x**: `Node | number` - Angle in radians.
:::

::: api cross( a, b ) : vec3 - Computes the cross product of 3D vectors `a` and `b`.
- **a**: `vec3` - First 3D vector.
- **b**: `vec3` - Second 3D vector.
:::

::: api dFdx( p ) : Node - Computes the partial derivative of `p` with respect to screen X axis.
- **p**: `Node` - Input expression node.
:::

::: api dFdy( p ) : Node - Computes the partial derivative of `p` with respect to screen Y axis.
- **p**: `Node` - Input expression node.
:::

::: api degrees( radians ) : Node - Converts an angle from radians to degrees.
- **radians**: `Node | number` - Angle in radians.
:::

::: api difference( a, b ) : Node - Computes the absolute difference `|a - b|`.
- **a**: `Node | number` - First value or node.
- **b**: `Node | number` - Second value or node.
:::

::: api distance( a, b ) : float - Computes the Euclidean distance between two points `length(a - b)`.
- **a**: `Node` - First point or vector node.
- **b**: `Node` - Second point or vector node.
:::

::: api dot( a, b ) : float - Computes the dot product of vectors `a` and `b`.
- **a**: `Node` - First vector node.
- **b**: `Node` - Second vector node.
:::

::: api equals( a, b ) : bool - Returns `true` if `a` equals `b`.
- **a**: `Node | number` - First value or node.
- **b**: `Node | number` - Second value or node.
:::

::: api exp( x ) : Node - Computes the natural exponential e^`x`.
- **x**: `Node | number` - Input value or node.
:::

::: api exp2( x ) : Node - Computes `2` raised to the power of `x`.
- **x**: `Node | number` - Input value or node.
:::

::: api faceforward( N, I, Nref ) : vec3 - Orients a normal vector to point away from a surface.
- **N**: `vec3` - Surface normal vector.
- **I**: `vec3` - Incident vector.
- **Nref**: `vec3` - Reference normal vector.
:::

::: api floor( x ) : Node - Rounds `x` down to the nearest integer.
- **x**: `Node | number` - Input value or node.
:::

::: api fract( x ) : Node - Computes the fractional part of `x` (`x - floor(x)`).
- **x**: `Node | number` - Input value or node.
:::

::: api fwidth( p ) : Node - Computes the sum of absolute partial derivatives `|dFdx(p)| + |dFdy(p)|`.
- **p**: `Node` - Input expression node.
:::

::: api inverseSqrt( x ) : Node - Computes the reciprocal of the square root `1 / sqrt(x)`.
- **x**: `Node | number` - Input value or node.
:::

::: api length( x ) : float - Computes the Euclidean length of vector `x`.
- **x**: `Node` - Vector node.
:::

::: api lengthSq( x ) : float - Computes the squared length of vector `x` (`dot(x, x)`).
- **x**: `Node` - Vector node.
:::

::: api log( x ) : Node - Computes the natural logarithm ln(`x`).
- **x**: `Node | number` - Input value or node.
:::

::: api log2( x ) : Node - Computes the base-2 logarithm log₂(`x`).
- **x**: `Node | number` - Input value or node.
:::

::: api max( a, b ) : Node - Returns the greater of two values.
- **a**: `Node | number` - First value or node.
- **b**: `Node | number` - Second value or node.
:::

::: api min( a, b ) : Node - Returns the lesser of two values.
- **a**: `Node | number` - First value or node.
- **b**: `Node | number` - Second value or node.
:::

::: api mix( a, b, t ) : Node - Linearly interpolates between `a` and `b`.
- **a**: `Node | number` - Start value or node (returned when `t = 0`).
- **b**: `Node | number` - End value or node (returned when `t = 1`).
- **t**: `Node | number` - Interpolation factor between `0` and `1`.
:::

::: api negate( x ) : Node - Negates the value of `x` (`-x`).
- **x**: `Node | number` - Input value or node.
:::

::: api normalize( x ) : Node - Computes the unit vector in the same direction as vector `x`.
- **x**: `Node` - Vector node.
:::

::: api oneMinus( x ) : Node - Computes `1 - x`.
- **x**: `Node | number` - Input value or node.
:::

::: api pow( x, y ) : Node - Computes `x` raised to power `y` (`x^y`).
- **x**: `Node | number` - Base value or node.
- **y**: `Node | number` - Exponent value or node.
:::

::: api pow2( x ) : Node - Computes the square of `x` (`x * x`).
- **x**: `Node | number` - Input value or node.
:::

::: api pow3( x ) : Node - Computes the cube of `x` (`x * x * x`).
- **x**: `Node | number` - Input value or node.
:::

::: api pow4( x ) : Node - Computes the fourth power of `x`.
- **x**: `Node | number` - Input value or node.
:::

::: api radians( degrees ) : Node - Converts an angle from degrees to radians.
- **degrees**: `Node | number` - Angle in degrees.
:::

::: api reciprocal( x ) : Node - Computes the reciprocal `1 / x`.
- **x**: `Node | number` - Input value or node.
:::

::: api reflect( I, N ) : vec3 - Computes the reflection direction for an incident vector.
- **I**: `vec3` - Incident vector pointing towards the surface.
- **N**: `vec3` - Normalized surface normal vector.
:::

::: api refract( I, N, eta ) : vec3 - Computes the refraction direction for an incident vector.
- **I**: `vec3` - Incident vector pointing towards the surface.
- **N**: `vec3` - Normalized surface normal vector.
- **eta**: `float | number` - Ratio of indices of refraction.
:::

::: api round( x ) : Node - Rounds `x` to the nearest integer.
- **x**: `Node | number` - Input value or node.
:::

::: api saturate( x ) : Node - Constrains `x` to range `[0, 1]`.
- **x**: `Node | number` - Input value or node.
:::

::: api sign( x ) : Node - Extracts the sign of `x` (`-1.0`, `0.0`, or `1.0`).
- **x**: `Node | number` - Input value or node.
:::

::: api sin( x ) : Node - Computes the sine of `x`.
- **x**: `Node | number` - Angle in radians.
:::

::: api smoothstep( low, high, x ) : Node - Performs smooth Hermite interpolation between `low` and `high` edges.
- **low**: `Node | number` - Lower edge threshold.
- **high**: `Node | number` - Upper edge threshold.
- **x**: `Node | number` - Source value to evaluate.
:::

::: api sqrt( x ) : Node - Computes the square root of `x`.
- **x**: `Node | number` - Input value or node.
:::

::: api step( edge, x ) : Node - Generates a step function, returning `0.0` if `x < edge`, else `1.0`.
- **edge**: `Node | number` - Threshold edge.
- **x**: `Node | number` - Source value.
:::

::: api tan( x ) : Node - Computes the tangent of `x`.
- **x**: `Node | number` - Angle in radians.
:::

::: api transformDirection( dir, matrix ) : vec3 - Transforms direction vector `dir` by `matrix` and normalizes the result.
- **dir**: `vec3` - Direction vector node.
- **matrix**: `mat4` - Transformation matrix node.
:::

::: api transformNormalByViewMatrix( normal, viewMatrix? ) : vec3 - Transforms a normal vector from world space to view space and normalizes the result.
- **normal**: `vec3` - World-space normal vector.
- **viewMatrix**: `mat4` - (Optional) View matrix node. Defaults to camera view matrix.
:::

::: api transformNormalByInverseViewMatrix( normal, viewMatrix? ) : vec3 - Transforms a normal vector from view space to world space and normalizes the result.
- **normal**: `vec3` - View-space normal vector.
- **viewMatrix**: `mat4` - (Optional) View matrix node. Defaults to camera view matrix.
:::

::: api trunc( x ) : Node - Truncates `x` towards zero, removing its fractional part.
- **x**: `Node | number` - Input value or node.
:::

> Important: Method Chaining Exceptions: In TSL method chaining `node.method(...)`, functions that accept interpolation or comparison factors use the calling node as the **last parameter** (the evaluation factor or source value):

::: api t.mix( a, b ) : Node - Method chaining form of `mix( a, b, t )`. Calling node `t` is the interpolation factor (0 to 1).
- **a**: `Node` - Start value node (returned when `t = 0`).
- **b**: `Node` - End value node (returned when `t = 1`).
:::

::: api x.smoothstep( low, high ) : Node - Method chaining form of `smoothstep( low, high, x )`. Calling node `x` is the source value evaluated between `low` and `high`.
- **low**: `Node` - Lower edge threshold.
- **high**: `Node` - Upper edge threshold.
:::

::: api x.step( edge ) : Node - Method chaining form of `step( edge, x )`. Calling node `x` is the source value compared against `edge`.
- **edge**: `Node` - Threshold edge node.
:::

```tsl
import 'scenes/shaderball';
import { abs, float } from 'three/tsl';

const value = float( - 1 );

// It's possible to use `value.abs()` too.
const positiveValue = abs( value ); // output: 1

model.material.colorNode = positiveValue;
```
