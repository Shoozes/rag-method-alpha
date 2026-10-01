*Inheritance: EventDispatcher → Node → LightingNode → AnalyticLightNode →*

# SunLightNode

Module for representing sun lights as nodes. Register it with the renderer's node library to use [SunLight](SunLight.md) with `WebGPURenderer`:

## Code Example

```js
renderer.library.addLight( SunLightNode, SunLight );
```

## Import

SunLightNode is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
```

## Constructor

### new SunLightNode( light : SunLight )

Constructs a new sun light node.

**light**

The sun light source.

Default is `null`.

## Methods

### .setupShadowNode() : SunShadowNode

Overwritten to setup the cascaded shadows of sun lights.

**Overrides:** [AnalyticLightNode#setupShadowNode](AnalyticLightNode.md#setupShadowNode)

**Returns:** The created shadow node.

## Source

[examples/jsm/lights/SunLightNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/lights/SunLightNode.js)
