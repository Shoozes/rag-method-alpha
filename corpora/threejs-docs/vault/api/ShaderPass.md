*Inheritance: Pass →*

# ShaderPass

This pass can be used to create a post processing effect with a raw GLSL shader object. Useful for implementing custom effects.

## Code Example

```js
const fxaaPass = new ShaderPass( FXAAShader );
composer.addPass( fxaaPass );
```

## Import

ShaderPass is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
```

## Constructor

### new ShaderPass( shader : Object | ShaderMaterial, textureID : string )

Constructs a new shader pass.

**shader**

A shader object holding vertex and fragment shader as well as defines and uniforms. It's also valid to pass a custom shader material.

**textureID**

The name of the texture uniform that should sample the read buffer.

Default is `'tDiffuse'`.

## Properties

### .material : ShaderMaterial

The pass material.

### .textureID : string

The name of the texture uniform that should sample the read buffer.

Default is `'tDiffuse'`.

### .uniforms : Object

The pass uniforms.

## Methods

### .dispose()

Frees the GPU-related resources allocated by this instance. Call this method whenever the pass is no longer used in your app.

**Overrides:** [Pass#dispose](Pass.md#dispose)

### .render( renderer : WebGLRenderer, writeBuffer : WebGLRenderTarget, readBuffer : WebGLRenderTarget, deltaTime : number, maskActive : boolean )

Performs the shader pass.

**renderer**

The renderer.

**writeBuffer**

The write buffer. This buffer is intended as the rendering destination for the pass.

**readBuffer**

The read buffer. The pass can access the result from the previous pass from this buffer.

**deltaTime**

The delta time in seconds.

**maskActive**

Whether masking is active or not.

**Overrides:** [Pass#render](Pass.md#render)

## Source

[examples/jsm/postprocessing/ShaderPass.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/postprocessing/ShaderPass.js)
