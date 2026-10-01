*Inheritance: EventDispatcher → Object3D → Mesh →*

# LightProbeHelper

Renders a sphere to visualize a light probe in the scene.

This helper can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), import from `LightProbeHelperGPU.js`.

## Code Example

```js
const helper = new LightProbeHelper( lightProbe );
scene.add( helper );
```

## Import

LightProbeHelper is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { LightProbeHelper } from 'three/addons/helpers/LightProbeHelper.js';
```

## Constructor

### new LightProbeHelper( lightProbe : LightProbe, size : number )

Constructs a new light probe helper.

**lightProbe**

The light probe to visualize.

**size**

The size of the helper.

Default is `1`.

## Properties

### .lightProbe : LightProbe

The light probe to visualize.

### .size : number

The size of the helper.

Default is `1`.

## Methods

### .dispose()

Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.

**Overrides:** [Mesh#dispose](Mesh.md#dispose)

## Source

[examples/jsm/helpers/LightProbeHelper.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/helpers/LightProbeHelper.js)
