*Inheritance: EventDispatcher → Texture →*

# ExternalTexture

Represents a texture created externally with the same renderer context.

This may be a texture from a protected media stream, device camera feed, or other data feeds like a depth sensor.

## Constructor

### new ExternalTexture( sourceTexture : WebGLTexture | GPUTexture )

Creates a new raw texture.

**sourceTexture**

The external texture.

Default is `null`.

## Properties

### .isExternalTexture : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .sourceTexture : WebGLTexture | GPUTexture

The external source texture.

Default is `null`.

## Source

[src/textures/ExternalTexture.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/textures/ExternalTexture.js)
