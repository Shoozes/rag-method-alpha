*Inheritance: EventDispatcher → RenderTarget → WebGLRenderTarget →*

# WebGLArrayRenderTarget

An array render target used in context of [WebGLRenderer](WebGLRenderer.md).

## Constructor

### new WebGLArrayRenderTarget( width : number, height : number, depth : number, options : RenderTarget~Options )

Constructs a new array render target.

**width**

The width of the render target.

Default is `1`.

**height**

The height of the render target.

Default is `1`.

**depth**

The height of the render target.

Default is `1`.

**options**

The configuration object.

## Properties

### .isWebGLArrayRenderTarget : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .texture : DataArrayTexture

Overwritten with a different texture type.

**Overrides:** [WebGLRenderTarget#texture](WebGLRenderTarget.md#texture)

## Source

[src/renderers/WebGLArrayRenderTarget.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/renderers/WebGLArrayRenderTarget.js)
