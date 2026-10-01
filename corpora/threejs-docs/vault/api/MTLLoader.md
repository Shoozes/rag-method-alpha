*Inheritance: Loader →*

# MTLLoader

A loader for the MTL format.

The Material Template Library format (MTL) or .MTL File Format is a companion file format to OBJ that describes surface shading (material) properties of objects within one or more OBJ files.

## Code Example

```js
const loader = new MTLLoader();
const materials = await loader.loadAsync( 'models/obj/male02/male02.mtl' );
const objLoader = new OBJLoader();
objLoader.setMaterials( materials );
```

## Import

MTLLoader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
```

## Constructor

### new MTLLoader()

## Methods

### .load( url : string, onLoad : function, onProgress : onProgressCallback, onError : onErrorCallback )

Starts loading from the given URL and passes the loaded MTL asset to the `onLoad()` callback.

**url**

The path/URL of the file to be loaded. This can also be a data URI.

**onLoad**

Executed when the loading process has been finished.

**onProgress**

Executed while the loading is in progress.

**onError**

Executed when errors occur.

**Overrides:** [Loader#load](Loader.md#load)

### .parse( text : string, path : string ) : MaterialCreator

Parses the given MTL data and returns the resulting material creator.

**text**

The raw MTL data as a string.

**path**

The URL base path.

**Overrides:** [Loader#parse](Loader.md#parse)

**Returns:** The material creator.

### .setMaterialOptions( value : MTLLoader~MaterialOptions ) : MTLLoader

Sets the material options.

**value**

The material options.

**Returns:** A reference to this loader.

## Type Definitions

### .MaterialOptions

Material options of `MTLLoader`.

**side**
[FrontSide](global.md#FrontSide) | [BackSide](global.md#BackSide) | [DoubleSide](global.md#DoubleSide)

Which side to apply the material.

Default is `FrontSide`.

**wrap**
[RepeatWrapping](global.md#RepeatWrapping) | [ClampToEdgeWrapping](global.md#ClampToEdgeWrapping) | [MirroredRepeatWrapping](global.md#MirroredRepeatWrapping)

What type of wrapping to apply for textures.

Default is `RepeatWrapping`.

**normalizeRGB**
boolean

Whether RGB colors should be normalized to `0-1` from `0-255`.

Default is `false`.

**ignoreZeroRGBs**
boolean

Ignore values of RGBs (Ka,Kd,Ks) that are all 0's.

Default is `false`.

## Source

[examples/jsm/loaders/MTLLoader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/loaders/MTLLoader.js)
