# StereoEffect

A class that creates an stereo effect.

Note that this class can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), use [StereoPassNode](StereoPassNode.md).

## Import

StereoEffect is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
```

## Constructor

### new StereoEffect( renderer : WebGLRenderer )

Constructs a new stereo effect.

**renderer**

The renderer.

## Methods

### .render( scene : Object3D, camera : Camera )

When using this effect, this method should be called instead of the default [WebGLRenderer#render](WebGLRenderer.md#render).

**scene**

The scene to render.

**camera**

The camera.

### .setEyeSeparation( eyeSep : number )

Sets the given eye separation.

**eyeSep**

The eye separation to set.

### .setSize( width : number, height : number )

Resizes the effect.

**width**

The width of the effect in logical pixels.

**height**

The height of the effect in logical pixels.

## Source

[examples/jsm/effects/StereoEffect.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/effects/StereoEffect.js)
