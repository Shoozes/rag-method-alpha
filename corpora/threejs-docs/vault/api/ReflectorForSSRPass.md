*Inheritance: EventDispatcher → Object3D → Mesh →*

# ReflectorForSSRPass

A special version of [Reflector](Reflector.md) for usage with [SSRPass](SSRPass.md).

## Import

ReflectorForSSRPass is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { ReflectorForSSRPass } from 'three/addons/objects/ReflectorForSSRPass.js';
```

## Constructor

### new ReflectorForSSRPass( geometry : BufferGeometry, options : ReflectorForSSRPass~Options )

Constructs a new reflector.

**geometry**

The reflector's geometry.

**options**

The configuration options.

## Methods

### .dispose()

Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.

**Overrides:** [Mesh#dispose](Mesh.md#dispose)

### .getRenderTarget() : WebGLRenderTarget

Returns the reflector's internal render target.

**Returns:** The internal render target

## Type Definitions

### .Options

Constructor options of `ReflectorForSSRPass`.

**color**
number | [Color](Color.md) | string

The reflector's color.

Default is `0x7F7F7F`.

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

**shader**
Object

Can be used to pass in a custom shader that defines how the reflective view is projected onto the reflector's geometry.

**useDepthTexture**
boolean

Whether to store depth values in a texture or not.

Default is `true`.

**resolution**
[Vector2](Vector2.md)

Resolution for the Reflector Pass.

## Source

[examples/jsm/objects/ReflectorForSSRPass.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/objects/ReflectorForSSRPass.js)
