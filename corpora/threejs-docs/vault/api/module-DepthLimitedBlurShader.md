# DepthLimitedBlurShader

## Import

DepthLimitedBlurShader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { DepthLimitedBlurShader, BlurShaderUtils } from 'three/addons/shaders/DepthLimitedBlurShader.js';
```

## Properties

### .DepthLimitedBlurShader : ShaderMaterial~Shader (inner, constant)

A separable Gaussian blur shader that limits blurring across depth discontinuities, stopping when the view-space depth difference to a neighboring sample exceeds `depthCutoff`. This preserves edges and avoids bleeding across them.

Used by [SAOPass](SAOPass.md).

## Source

[examples/jsm/shaders/DepthLimitedBlurShader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/shaders/DepthLimitedBlurShader.js)
