*Inheritance: EventDispatcher → Node → TempNode → PassNode → StereoCompositePassNode →*

# ParallaxBarrierPassNode

A render pass node that creates a parallax barrier effect.

## Import

ParallaxBarrierPassNode is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { parallaxBarrierPass } from 'three/addons/tsl/display/ParallaxBarrierPassNode.js';
```

## Constructor

### new ParallaxBarrierPassNode( scene : Scene, camera : Camera )

Constructs a new parallax barrier pass node.

**scene**

The scene to render.

**camera**

The camera to render the scene with.

## Properties

### .isParallaxBarrierPassNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

## Methods

### .setup( builder : NodeBuilder ) : PassTextureNode

This method is used to setup the effect's TSL code.

**builder**

The current node builder.

**Overrides:** [StereoCompositePassNode#setup](StereoCompositePassNode.md#setup)

## Source

[examples/jsm/tsl/display/ParallaxBarrierPassNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/tsl/display/ParallaxBarrierPassNode.js)
