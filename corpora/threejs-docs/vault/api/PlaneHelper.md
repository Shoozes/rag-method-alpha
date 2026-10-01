*Inheritance: EventDispatcher → Object3D → Line →*

# PlaneHelper

A helper object to visualize an instance of [Plane](Plane.md).

## Code Example

```js
const plane = new THREE.Plane( new THREE.Vector3( 1, 1, 0.2 ), 3 );
const helper = new THREE.PlaneHelper( plane, 1, 0xffff00 );
scene.add( helper );
```

## Constructor

### new PlaneHelper( plane : Plane, size : number, hex : number | Color | string )

Constructs a new plane helper.

**plane**

The plane to be visualized.

**size**

The side length of plane helper.

Default is `1`.

**hex**

The helper's color.

Default is `0xffff00`.

## Properties

### .plane : Plane

The plane being visualized.

### .size : number

The side length of plane helper.

Default is `1`.

## Methods

### .dispose()

Updates the helper to match the position and direction of the light being visualized.

**Overrides:** [Line#dispose](Line.md#dispose)

## Source

[src/helpers/PlaneHelper.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/helpers/PlaneHelper.js)
