# ImageUtils

A class containing utility functions for images.

## Static Methods

### .getDataURL( image : HTMLImageElement | HTMLCanvasElement, type : string ) : string

Returns a data URI containing a representation of the given image.

**image**

The image object.

**type**

Indicates the image format.

Default is `'image/png'`.

**Returns:** The data URI.

### .sRGBToLinear( image : HTMLImageElement | HTMLCanvasElement | ImageBitmap | Object ) : HTMLCanvasElement | Object

Converts the given sRGB image data to linear color space.

**image**

The image object.

**Returns:** The converted image.

## Source

[src/extras/ImageUtils.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/extras/ImageUtils.js)
