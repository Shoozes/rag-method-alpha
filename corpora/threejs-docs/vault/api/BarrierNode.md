*Inheritance: EventDispatcher → Node →*

# BarrierNode

Represents a GPU control barrier that synchronizes compute operations within a given scope.

This node can only be used with a WebGPU backend.

## Constructor

### new BarrierNode( scope : string )

Constructs a new barrier node.

**scope**

The scope defines the behavior of the node.

## Source

[src/nodes/gpgpu/BarrierNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/gpgpu/BarrierNode.js)
