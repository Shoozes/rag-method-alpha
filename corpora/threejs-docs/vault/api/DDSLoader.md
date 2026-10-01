*Inheritance: Loader → CompressedTextureLoader →*

# DDSLoader

A loader for the S3TC texture compression format.

## Code Example

```js
const loader = new DDSLoader();
const map = loader.load( 'textures/compressed/disturb_dxt1_nomip.dds' );
map.colorSpace = THREE.SRGBColorSpace; // only for color textures
```

## Import

DDSLoader is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
```

## Constructor

### new DDSLoader( manager : LoadingManager )

Constructs a new DDS loader.

**manager**

The loading manager.

## Methods

### .parse( buffer : ArrayBuffer, loadMipmaps : boolean ) : CompressedTextureLoader~TexData

Parses the given S3TC texture data.

**buffer**

The raw texture data.

**loadMipmaps**

Whether to load mipmaps or not.

**Overrides:** [CompressedTextureLoader#parse](CompressedTextureLoader.md#parse)

**Returns:** An object representing the parsed texture data.

## Source

[examples/jsm/loaders/DDSLoader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/loaders/DDSLoader.js)
