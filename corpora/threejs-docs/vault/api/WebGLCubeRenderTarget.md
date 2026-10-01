*Inheritance: EventDispatcher → RenderTarget → WebGLRenderTarget →*

# WebGLCubeRenderTarget

A cube render target used in context of [WebGLRenderer](WebGLRenderer.md).

## Constructor

### new WebGLCubeRenderTarget( size : number, options : RenderTarget~Options )

Constructs a new cube render target.

**size**

The size of the render target.

Default is `1`.

**options**

The configuration object.

## Properties

### .isWebGLCubeRenderTarget : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .texture : DataArrayTexture

Overwritten with a different texture type.

**Overrides:** [WebGLRenderTarget#texture](WebGLRenderTarget.md#texture)

## Methods

### .clear( renderer : WebGLRenderer, color : boolean, depth : boolean, stencil : boolean )

Clears this cube render target.

**renderer**

The renderer.

**color**

Whether the color buffer should be cleared or not.

Default is `true`.

**depth**

Whether the depth buffer should be cleared or not.

Default is `true`.

**stencil**

Whether the stencil buffer should be cleared or not.

Default is `true`.

### .fromEquirectangularTexture( renderer : WebGLRenderer, texture : Texture ) : WebGLCubeRenderTarget

Converts the given equirectangular texture to a cube map.

**renderer**

The renderer.

**texture**

The equirectangular texture.

**Returns:** A reference to this cube render target.

## Source

[src/renderers/WebGLCubeRenderTarget.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/renderers/WebGLCubeRenderTarget.js)
