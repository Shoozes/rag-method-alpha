*Inheritance: EventDispatcher → Object3D → Mesh →*

# Water

A basic flat, reflective water effect.

Note that this class can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), use [WaterMesh](WaterMesh.md).

References:

*   [Flat mirror for three.js](https://github.com/Slayvin)
*   [An implementation of water shader based on the flat mirror](https://home.adelphi.edu/~stemkoski/)
*   [Water shader explanations in WebGL](http://29a.ch/slides/2012/webglwater/)

## Import

Water is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { Water } from 'three/addons/objects/Water.js';
```

## Constructor

### new Water( geometry : BufferGeometry, options : Water~Options )

Constructs a new water instance.

**geometry**

The water's geometry.

**options**

The configuration options.

## Properties

### .isWater : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Type Definitions

### .Options

Constructor options of `Water`.

**textureWidth**
number

The texture width. A higher value results in more clear reflections but is also more expensive.

Default is `512`.

**textureHeight**
number

The texture height. A higher value results in more clear reflections but is also more expensive.

Default is `512`.

**clipBias**
number

The clip bias.

Default is `0`.

**alpha**
number

The alpha value.

Default is `1`.

**time**
number

The time value.

Default is `0`.

**waterNormals**
[Texture](Texture.md)

The water's normal map.

Default is `null`.

**sunDirection**
[Vector3](Vector3.md)

The sun direction.

Default is `(0.70707,0.70707,0.0)`.

**sunColor**
number | [Color](Color.md) | string

The sun color.

Default is `0xffffff`.

**waterColor**
number | [Color](Color.md) | string

The water color.

Default is `0x7F7F7F`.

**eye**
[Vector3](Vector3.md)

The eye vector.

**distortionScale**
number

The distortion scale.

Default is `20`.

**side**
[FrontSide](global.md#FrontSide) | [BackSide](global.md#BackSide) | [DoubleSide](global.md#DoubleSide)

The water material's `side` property.

Default is `FrontSide`.

**fog**
boolean

Whether the water should be affected by fog or not.

Default is `false`.

## Source

[examples/jsm/objects/Water.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/objects/Water.js)
