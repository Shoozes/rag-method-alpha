# Module

Module.js - Base class for LUT 3D Generator Card Modules

## Constructor

### new Module()

## Classes

[Module](Module.md)

## Methods

### .apply( buffer : Float32Array, size : number ) : Float32Array

Applies module transformation directly onto a Float32Array 3D LUT buffer.

**buffer**

Buffer of size x size x size x 4 RGBA elements

**size**

LUT grid dimension

### .applyPixel()

Transforms a single RGB color pixel (0..1 range) into a reusable target array. Virtual method to be overridden by sub-classes.

### .createCardHeader()

Helper to create standard card header with title, reset button, and optional remove button.

### .createSliderControl()

Helper to create parameter box with label, draggable number input, and range slider.

## Source

[examples/jsm/inspector/extensions/color-grading/modules/Module.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/inspector/extensions/color-grading/modules/Module.js)
