*Inheritance: EventDispatcher → Texture →*

# DataArrayTexture

Creates an array of textures directly from raw buffer data.

## Constructor

### new DataArrayTexture( data : TypedArray, width : number, height : number, depth : number )

Constructs a new data array texture.

**data**

The buffer data.

Default is `null`.

**width**

The width of the texture.

Default is `1`.

**height**

The height of the texture.

Default is `1`.

**depth**

The depth of the texture.

Default is `1`.

## Properties

### .flipY : boolean

If set to `true`, the texture is flipped along the vertical axis when uploaded to the GPU.

Overwritten and set to `false` by default.

Default is `false`.

**Overrides:** [Texture#flipY](Texture.md#flipY)

### .generateMipmaps : boolean

Whether to generate mipmaps (if possible) for a texture.

Overwritten and set to `false` by default.

Default is `false`.

**Overrides:** [Texture#generateMipmaps](Texture.md#generateMipmaps)

### .image : Object

The image definition of a data texture.

**Overrides:** [Texture#image](Texture.md#image)

### .isDataArrayTexture : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .layerUpdates : Set.<number>

A set of all layers which need to be updated in the texture.

### .magFilter : NearestFilter | NearestMipmapNearestFilter | NearestMipmapLinearFilter | LinearFilter | LinearMipmapNearestFilter | LinearMipmapLinearFilter

How the texture is sampled when a texel covers more than one pixel.

Overwritten and set to `NearestFilter` by default.

Default is `NearestFilter`.

**Overrides:** [Texture#magFilter](Texture.md#magFilter)

### .minFilter : NearestFilter | NearestMipmapNearestFilter | NearestMipmapLinearFilter | LinearFilter | LinearMipmapNearestFilter | LinearMipmapLinearFilter

How the texture is sampled when a texel covers less than one pixel.

Overwritten and set to `NearestFilter` by default.

Default is `NearestFilter`.

**Overrides:** [Texture#minFilter](Texture.md#minFilter)

### .unpackAlignment : boolean

Specifies the alignment requirements for the start of each pixel row in memory.

Overwritten and set to `1` by default.

Default is `1`.

**Overrides:** [Texture#unpackAlignment](Texture.md#unpackAlignment)

### .wrapR : RepeatWrapping | ClampToEdgeWrapping | MirroredRepeatWrapping

This defines how the texture is wrapped in the depth and corresponds to _W_ in UVW mapping.

Default is `ClampToEdgeWrapping`.

## Methods

### .addLayerUpdate( layerIndex : number )

Describes that a specific layer of the texture needs to be updated. Normally when [Texture#needsUpdate](Texture.md#needsUpdate) is set to `true`, the entire data texture array is sent to the GPU. Marking specific layers will only transmit subsets of all mipmaps associated with a specific depth in the array which is often much more performant.

**layerIndex**

The layer index that should be updated.

### .clearLayerUpdates()

Resets the layer updates registry.

### .copy( source : DataArrayTexture ) : DataArrayTexture

Copies the values of the given texture to this instance.

**source**

The texture to copy.

**Overrides:** [Texture#copy](Texture.md#copy)

**Returns:** A reference to this instance.

## Source

[src/textures/DataArrayTexture.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/textures/DataArrayTexture.js)
