# SSAOShader

## Import

SSAOShader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { SSAOShader } from 'three/addons/shaders/SSAOShader.js';
```

## Properties

### .SSAOBlurShader : Object (inner, constant)

SSAO blur shader.

### .SSAODepthShader : ShaderMaterial~Shader (inner, constant)

SSAO depth shader.

### .SSAOShader : ShaderMaterial~Shader (inner, constant)

SSAO shader.

References:

*   [http://john-chapman-graphics.blogspot.com/2013/01/ssao-tutorial.html](http://john-chapman-graphics.blogspot.com/2013/01/ssao-tutorial.md)
*   [https://learnopengl.com/Advanced-Lighting/SSAO](https://learnopengl.com/Advanced-Lighting/SSAO)
*   [https://github.com/McNopper/OpenGL/blob/master/Example28/shader/ssao.frag.glsl](https://github.com/McNopper/OpenGL/blob/master/Example28/shader/ssao.frag.glsl)

## Source

[examples/jsm/shaders/SSAOShader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/shaders/SSAOShader.js)
