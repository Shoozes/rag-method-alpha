# WebGLTextureUtils

## Import

WebGLTextureUtils is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import * as WebGLTextureUtils from 'three/addons/utils/WebGLTextureUtils.js';
```

## Static Methods

### .decompress( texture : CompressedTexture, maxTextureSize : number, renderer : WebGLRenderer ) : CanvasTexture

Returns an uncompressed version of the given compressed texture.

This module can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), import the function from [module:WebGPUTextureUtils](module-WebGPUTextureUtils.md).

**texture**

The compressed texture.

**maxTextureSize**

The maximum size of the uncompressed texture.

Default is `Infinity`.

**renderer**

A reference to a renderer.

Default is `null`.

**Returns:** The uncompressed texture.

## Source

[examples/jsm/utils/WebGLTextureUtils.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/utils/WebGLTextureUtils.js)
