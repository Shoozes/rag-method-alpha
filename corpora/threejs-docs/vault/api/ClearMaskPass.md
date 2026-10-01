*Inheritance: Pass →*

# ClearMaskPass

This pass can be used to clear a mask previously defined with [MaskPass](MaskPass.md).

## Code Example

```js
const clearPass = new ClearMaskPass();
composer.addPass( clearPass );
```

## Constructor

### new ClearMaskPass()

Constructs a new clear mask pass.

## Properties

### .needsSwap : boolean

Overwritten to disable the swap.

Default is `false`.

**Overrides:** [Pass#needsSwap](Pass.md#needsSwap)

## Methods

### .render( renderer : WebGLRenderer, writeBuffer : WebGLRenderTarget, readBuffer : WebGLRenderTarget, deltaTime : number, maskActive : boolean )

Performs the clear of the currently defined mask.

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

[examples/jsm/postprocessing/MaskPass.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/postprocessing/MaskPass.js)
