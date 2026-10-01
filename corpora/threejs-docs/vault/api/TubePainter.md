# TubePainter

This module can be used to paint tube-like meshes along a sequence of points. This module is used in a XR painter demo.

## Code Example

```js
const painter = new TubePainter();
scene.add( painter.mesh );
```

## Import

TubePainter is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { TubePainter } from 'three/addons/misc/TubePainter.js';
```

## Constructor

### new TubePainter()

## Properties

### .mesh : Mesh

The "painted" tube mesh. Must be added to the scene.

## Methods

### .lineTo( position : Vector3 )

Draw a stroke from the current position to the given one. This method extends the tube while drawing with the XR controllers.

**position**

The destination position.

### .moveTo( position : Vector3 )

Moves the current painting position to the given value.

**position**

The new painting position.

### .setColor( color : Color )

Sets the color of newly rendered tube segments.

**color**

The color.

### .setSize( size : number )

Sets the size of newly rendered tube segments.

**size**

The size.

### .update()

Updates the internal geometry buffers so the new painted segments are rendered.

## Source

[examples/jsm/misc/TubePainter.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/misc/TubePainter.js)
