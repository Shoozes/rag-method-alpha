# ParallaxBarrierEffect

A class that creates an parallax barrier effect.

Note that this class can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), use [ParallaxBarrierPassNode](ParallaxBarrierPassNode.md).

## Import

ParallaxBarrierEffect is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { ParallaxBarrierEffect } from 'three/addons/effects/ParallaxBarrierEffect.js';
```

## Constructor

### new ParallaxBarrierEffect( renderer : WebGLRenderer )

Constructs a new parallax barrier effect.

**renderer**

The renderer.

## Methods

### .dispose()

Frees internal resources. This method should be called when the effect is no longer required.

### .render( scene : Object3D, camera : Camera )

When using this effect, this method should be called instead of the default [WebGLRenderer#render](WebGLRenderer.md#render).

**scene**

The scene to render.

**camera**

The camera.

### .setSize( width : number, height : number )

Resizes the effect.

**width**

The width of the effect in logical pixels.

**height**

The height of the effect in logical pixels.

## Source

[examples/jsm/effects/ParallaxBarrierEffect.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/effects/ParallaxBarrierEffect.js)
