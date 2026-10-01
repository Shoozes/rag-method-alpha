*Inheritance: EventDispatcher → Object3D →*

# Light

Abstract base class for lights - all other light types inherit the properties and methods described here.

## Constructor

### new Light( color : number | Color | string, intensity : number ) (abstract)

Constructs a new light.

**color**

The light's color.

Default is `0xffffff`.

**intensity**

The light's strength/intensity.

Default is `1`.

## Properties

### .color : Color

The light's color.

### .intensity : number

The light's intensity.

Default is `1`.

### .isLight : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/lights/Light.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/lights/Light.js)
