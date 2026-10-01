# WebGPUTextureUtils

## Import

WebGPUTextureUtils is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import * as WebGPUTextureUtils from 'three/addons/utils/WebGPUTextureUtils.js';
```

## Static Methods

### .decompress( blitTexture : CompressedTexture, maxTextureSize : number, renderer : WebGPURenderer ) : Promise.<CanvasTexture> (async)

Returns an uncompressed version of the given compressed texture.

This module can only be used with [WebGPURenderer](WebGPURenderer.md). When using [WebGLRenderer](WebGLRenderer.md), import the function from [module:WebGLTextureUtils](module-WebGLTextureUtils.md).

**blitTexture**

The compressed texture.

**maxTextureSize**

The maximum size of the uncompressed texture.

Default is `Infinity`.

**renderer**

A reference to a renderer.

Default is `null`.

**Returns:** A Promise that resolved with the uncompressed texture.

## Source

[examples/jsm/utils/WebGPUTextureUtils.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/utils/WebGPUTextureUtils.js)
