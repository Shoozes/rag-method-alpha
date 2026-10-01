*Inheritance: KeyframeTrack →*

# ColorKeyframeTrack

A track for color keyframe values.

## Constructor

### new ColorKeyframeTrack( name : string, times : Array.<number>, values : Array.<number>, interpolation : InterpolateLinear | InterpolateDiscrete | InterpolateSmooth )

Constructs a new color keyframe track.

**name**

The keyframe track's name.

**times**

A list of keyframe times.

**values**

A list of keyframe values.

**interpolation**

The interpolation type.

## Properties

### .ValueTypeName : string

The value type name.

Default is `'color'`.

**Overrides:** [KeyframeTrack#ValueTypeName](KeyframeTrack.md#ValueTypeName)

## Source

[src/animation/tracks/ColorKeyframeTrack.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/animation/tracks/ColorKeyframeTrack.js)
