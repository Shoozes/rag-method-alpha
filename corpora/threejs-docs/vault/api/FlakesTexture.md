# FlakesTexture

Utility class for generating a flakes texture image. This image might be used as a normal map to produce a car paint like effect.

## Import

FlakesTexture is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { FlakesTexture } from 'three/addons/textures/FlakesTexture.js';
```

## Constructor

### new FlakesTexture( width : number, height : number ) : HTMLCanvasElement

Generates a new flakes texture image. The result is a canvas that can be used as an input for [CanvasTexture](CanvasTexture.md).

**width**

The width of the image.

Default is `512`.

**height**

The height of the image.

Default is `512`.

**Returns:** The generated image.

## Source

[examples/jsm/textures/FlakesTexture.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/textures/FlakesTexture.js)
