*Inheritance: EventDispatcher → Node → TempNode →*

# FilmNode

Post processing node for creating a film grain effect.

## Import

FilmNode is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { film } from 'three/addons/tsl/display/FilmNode.js';
```

## Constructor

### new FilmNode( inputNode : Node, intensityNode : Node.<float>, uvNode : Node.<vec2> )

Constructs a new film node.

**inputNode**

The node that represents the input of the effect.

**intensityNode**

A node that represents the effect's intensity.

Default is `null`.

**uvNode**

A node that allows to pass custom (e.g. animated) uv data.

Default is `null`.

## Properties

### .inputNode : Node

The node that represents the input of the effect.

### .intensityNode : Node.<float>

A node that represents the effect's intensity.

Default is `null`.

### .uvNode : Node.<vec2>

A node that allows to pass custom (e.g. animated) uv data.

Default is `null`.

## Methods

### .setup( builder : NodeBuilder ) : ShaderCallNodeInternal

This method is used to setup the effect's TSL code.

**builder**

The current node builder.

**Overrides:** [TempNode#setup](TempNode.md#setup)

## Source

[examples/jsm/tsl/display/FilmNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/tsl/display/FilmNode.js)
