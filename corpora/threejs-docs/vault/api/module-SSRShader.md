# SSRShader

## Import

SSRShader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import * as SSRShader from 'three/addons/shaders/SSRShader.js';
```

A collection of shaders used for SSR.

References:

*   [3D Game Shaders For Beginners, Screen Space Reflection (SSR)](https://lettier.github.io/3d-game-shaders-for-beginners/screen-space-reflection.md).

## Properties

### .SSRBlurShader : ShaderMaterial~Shader (inner, constant)

SSR Blur shader.

### .SSRDepthShader : ShaderMaterial~Shader (inner, constant)

SSR Depth shader.

### .SSRShader : ShaderMaterial~Shader (inner, constant)

SSR shader.

## Source

[examples/jsm/shaders/SSRShader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/shaders/SSRShader.js)
