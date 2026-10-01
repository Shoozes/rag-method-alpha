*Inheritance: EventDispatcher → Object3D → Mesh →*

# TextureHelper

A helper that can be used to display any type of texture for debugging purposes. Depending on the type of texture (2D, 3D, Array), the helper becomes a plane or box mesh.

This helper can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), import from `TextureHelperGPU.js`.

## Import

TextureHelper is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { TextureHelper } from 'three/addons/helpers/TextureHelper.js';
```

## Constructor

### new TextureHelper( texture : Texture, width : number, height : number, depth : number )

Constructs a new texture helper.

**texture**

The texture to visualize.

**width**

The helper's width.

Default is `1`.

**height**

The helper's height.

Default is `1`.

**depth**

The helper's depth.

Default is `1`.

## Properties

### .texture : Texture

The texture to visualize.

## Methods

### .dispose()

Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.

**Overrides:** [Mesh#dispose](Mesh.md#dispose)

## Source

[examples/jsm/helpers/TextureHelper.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/helpers/TextureHelper.js)
