*Inheritance: LightShadow →*

# SpotLightShadow

Represents the shadow configuration of directional lights.

## Constructor

### new SpotLightShadow()

Constructs a new spot light shadow.

## Properties

### .aspect : number

Texture aspect ratio.

Default is `1`.

### .focus : number

Used to focus the shadow camera. The camera's field of view is set as a percentage of the spotlight's field-of-view. Range is `[0, 1]`.

Default is `1`.

### .isSpotLightShadow : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Methods

### .toJSON() : Object

Serializes the light shadow into JSON.

**Overrides:** [LightShadow#toJSON](LightShadow.md#toJSON)

See:

*   [ObjectLoader#parse](ObjectLoader.md#parse)

**Returns:** A JSON object representing the serialized light shadow.

## Source

[src/lights/SpotLightShadow.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/lights/SpotLightShadow.js)
