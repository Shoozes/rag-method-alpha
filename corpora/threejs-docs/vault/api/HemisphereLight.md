*Inheritance: EventDispatcher → Object3D → Light →*

# HemisphereLight

A light source positioned directly above the scene, with color fading from the sky color to the ground color.

This light cannot be used to cast shadows.

## Code Example

```js
const light = new THREE.HemisphereLight( 0xffffbb, 0x080820, 1 );
scene.add( light );
```

## Constructor

### new HemisphereLight( skyColor : number | Color | string, groundColor : number | Color | string, intensity : number )

Constructs a new hemisphere light.

**skyColor**

The light's sky color.

Default is `0xffffff`.

**groundColor**

The light's ground color.

Default is `0xffffff`.

**intensity**

The light's strength/intensity.

Default is `1`.

## Properties

### .groundColor : Color

The light's ground color.

### .isHemisphereLight : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Source

[src/lights/HemisphereLight.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/lights/HemisphereLight.js)
