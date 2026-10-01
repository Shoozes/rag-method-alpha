*Inheritance: EventDispatcher → Node → TempNode →*

# VelocityNode

A node for representing motion or velocity vectors. Foundation for advanced post processing effects like motion blur or TRAA.

The node keeps track of the model, view and projection matrices of the previous frame and uses them to compute offsets in NDC space. These offsets represent the final velocity.

## Constructor

### new VelocityNode()

Constructs a new vertex color node.

## Properties

### .previousCameraViewMatrix : UniformNode.<mat4>

Uniform node representing the previous view matrix.

Default is `null`.

### .previousModelWorldMatrix : UniformNode.<mat4>

Uniform node representing the previous model matrix in world space.

Default is `null`.

### .previousProjectionMatrix : UniformNode.<mat4>

Uniform node representing the previous projection matrix.

Default is `null`.

### .projectionMatrix : Matrix4

The current projection matrix.

Default is `null`.

### .updateAfterType : string

Overwritten since velocity nodes save data after the update.

Default is `'object'`.

**Overrides:** [TempNode#updateAfterType](TempNode.md#updateAfterType)

### .updateType : string

Overwritten since velocity nodes are updated per object.

Default is `'object'`.

**Overrides:** [TempNode#updateType](TempNode.md#updateType)

## Methods

### .setProjectionMatrix( projectionMatrix : Matrix4 )

Sets the given projection matrix.

**projectionMatrix**

The projection matrix to set.

### .setup( builder : NodeBuilder ) : Node.<vec2>

Implements the velocity computation based on the previous and current vertex data.

**builder**

A reference to the current node builder.

**Overrides:** [TempNode#setup](TempNode.md#setup)

**Returns:** The motion vector.

### .update( frame : NodeFrame )

Updates velocity specific uniforms.

**frame**

A reference to the current node frame.

**Overrides:** [TempNode#update](TempNode.md#update)

### .updateAfter( frame : NodeFrame )

Overwritten to updated velocity specific uniforms.

**frame**

A reference to the current node frame.

**Overrides:** [TempNode#updateAfter](TempNode.md#updateAfter)

## Source

[src/nodes/accessors/VelocityNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/accessors/VelocityNode.js)
