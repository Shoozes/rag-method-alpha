*Inheritance: EventDispatcher → Node → ShadowBaseNode →*

# CSMShadowNode

An implementation of Cascade Shadow Maps (CSM).

This module can only be used with [WebGPURenderer](WebGPURenderer.md). When using [WebGLRenderer](WebGLRenderer.md), use [CSM](CSM.md) instead.

## Import

CSMShadowNode is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
```

## Constructor

### new CSMShadowNode( light : DirectionalLight, data : CSMShadowNode~Data )

Constructs a new CSM shadow node.

**light**

The CSM light.

**data**

The CSM data.

Default is `{}`.

## Properties

### .breaks : Array.<number>

An array of numbers in the range `[0,1]` the defines how the mainCSM frustum should be split up.

### .camera : Camera

The scene's camera.

Default is `null`.

### .cascades : number

The number of cascades.

Default is `3`.

### .customSplitsCallback : function

Custom split callback when using `mode='custom'`.

### .fade : boolean

Whether to fade between cascades or not.

Default is `false`.

### .frustums : Array.<CSMFrustum>

An array of frustums representing the cascades.

### .lightMargin : number

The light margin.

Default is `200`.

### .lights : Array.<DirectionalLight>

An array of directional lights which cast the shadows for the different cascades. There is one directional light for each cascade.

### .mainFrustum : CSMFrustum

The main frustum.

Default is `null`.

### .maxFar : number

The maximum far value.

Default is `100000`.

### .mode : 'practical' | 'uniform' | 'logarithmic' | 'custom'

The frustum split mode.

Default is `'practical'`.

## Methods

### .dispose()

Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.

**Overrides:** [ShadowBaseNode#dispose](ShadowBaseNode.md#dispose)

### .updateFrustums()

Applications must call this method every time they change camera or CSM settings.

## Type Definitions

### .Data

Constructor data of `CSMShadowNode`.

**cascades**
number

The number of cascades.

Default is `3`.

**maxFar**
number

The maximum far value.

Default is `100000`.

**mode**
'practical' | 'uniform' | 'logarithmic' | 'custom'

The frustum split mode.

Default is `'practical'`.

**customSplitsCallback**
function

Custom split callback when using `mode='custom'`.

**lightMargin**
number

The light margin.

Default is `200`.

## Source

[examples/jsm/csm/CSMShadowNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/csm/CSMShadowNode.js)
