# GTAOShader

## Import

GTAOShader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { GTAOShader } from 'three/addons/shaders/GTAOShader.js';
```

## Properties

### .GTAOBlendShader : Object (inner, constant)

GTAO blend shader. Use by [GTAOPass](GTAOPass.md).

### .GTAODepthShader : Object (inner, constant)

GTAO depth shader. Use by [GTAOPass](GTAOPass.md).

### .GTAOShader : ShaderMaterial~Shader (inner, constant)

GTAO shader. Use by [GTAOPass](GTAOPass.md).

References:

*   [Practical Realtime Strategies for Accurate Indirect Occlusion](https://iryoku.com/downloads/Practical-Realtime-Strategies-for-Accurate-Indirect-Occlusion.pdf).
*   [Horizon-Based Indirect Lighting (HBIL)](https://github.com/Patapom/GodComplex/blob/master/Tests/TestHBIL/2018%20Mayaux%20-%20Horizon-Based%20Indirect%20Lighting%20\(HBIL\).pdf)

## Source

[examples/jsm/shaders/GTAOShader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/shaders/GTAOShader.js)
