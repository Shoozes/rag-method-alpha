# FreiChenShader

## Import

FreiChenShader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { FreiChenShader } from 'three/addons/shaders/FreiChenShader.js';
```

## Properties

### .FreiChenShader : ShaderMaterial~Shader (inner, constant)

Edge Detection Shader using Frei-Chen filter. Based on [http://rastergrid.com/blog/2011/01/frei-chen-edge-detector](http://rastergrid.com/blog/2011/01/frei-chen-edge-detector).

aspect: vec2 of (1/width, 1/height)

## Source

[examples/jsm/shaders/FreiChenShader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/shaders/FreiChenShader.js)
