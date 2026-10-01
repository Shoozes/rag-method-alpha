*Inheritance: EventDispatcher → Material → ShaderMaterial →*

# LineMaterial

A material for drawing wireframe-style geometries.

Unlike [LineBasicMaterial](LineBasicMaterial.md), it supports arbitrary line widths and allows using world units instead of screen space units. This material is used with [LineSegments2](LineSegments2.md) and [Line2](Line2.md).

This module can only be used with [WebGLRenderer](WebGLRenderer.md). When using [WebGPURenderer](WebGPURenderer.md), use [Line2NodeMaterial](Line2NodeMaterial.md).

## Import

LineMaterial is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
```

## Constructor

### new LineMaterial( parameters : Object )

Constructs a new line segments geometry.

**parameters**

An object with one or more properties defining the material's appearance. Any property of the material (including any property from inherited materials) can be passed in here. Color values can be passed any type of value accepted by [Color#set](Color.md#set).

## Properties

### .alphaToCoverage : boolean

Whether to use alphaToCoverage or not. When enabled, this can improve the anti-aliasing of line edges when using MSAA.

**Overrides:** [ShaderMaterial#alphaToCoverage](ShaderMaterial.md#alphaToCoverage)

### .color : Color

The material's color.

Default is `(1,1,1)`.

### .dashOffset : number

Where in the dash cycle the dash starts.

Default is `0`.

### .dashScale : number

The scale of the dashes and gaps.

Default is `1`.

### .dashSize : number

The size of the dash.

Default is `1`.

### .dashed : boolean

Whether the line is dashed, or solid.

Default is `false`.

### .gapSize : number

The size of the gap.

Default is `0`.

### .isLineMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .linewidth : number

Controls line thickness in CSS pixel units when `worldUnits` is `false` (default), or in world units when `worldUnits` is `true`.

Default is `1`.

**Overrides:** [ShaderMaterial#linewidth](ShaderMaterial.md#linewidth)

### .opacity : number

The opacity.

Default is `1`.

**Overrides:** [ShaderMaterial#opacity](ShaderMaterial.md#opacity)

### .resolution : Vector2

The size of the viewport, in screen pixels. This must be kept updated to make screen-space rendering accurate. The `LineSegments2.onBeforeRender` callback performs the update for visible objects.

### .worldUnits : boolean

Whether the material's sizes (width, dash gaps) are in world units.

Default is `false`.

## Source

[examples/jsm/lines/LineMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/lines/LineMaterial.js)
