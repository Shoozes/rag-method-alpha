# RectAreaLightUniformsLib

This class is only relevant when using [RectAreaLight](RectAreaLight.md) with [WebGLRenderer](WebGLRenderer.md).

Before rect area lights can be used, the internal uniform library of the renderer must be enhanced with the following code.

## Code Example

```js
RectAreaLightUniformsLib.init();
```

## Import

RectAreaLightUniformsLib is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
```

## Static Methods

### .init()

Inits the uniform library required when using rect area lights.

## Source

[examples/jsm/lights/RectAreaLightUniformsLib.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/lights/RectAreaLightUniformsLib.js)
