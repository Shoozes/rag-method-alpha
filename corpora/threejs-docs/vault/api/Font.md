# Font

Class representing a font.

## Constructor

### new Font( data : Object )

Constructs a new font.

**data**

The font data as JSON.

## Properties

### .data : Object

The font data as JSON.

### .isFont : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Methods

### .generateShapes( text : string, size : number, direction : string ) : Array.<Shape>

Generates geometry shapes from the given text and size. The result of this method should be used with [ShapeGeometry](ShapeGeometry.md) to generate the actual geometry data.

**text**

The text.

**size**

The text size.

Default is `100`.

**direction**

Char direction: ltr(left to right), rtl(right to left) & tb(top bottom).

Default is `'ltr'`.

**Returns:** An array of shapes representing the text.

## Source

[examples/jsm/loaders/FontLoader.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/loaders/FontLoader.js)
