*Inheritance: EventDispatcher → Node →*

# UniformGroupNode

This node can be used to group single instances of [UniformNode](UniformNode.md) and manage them as a uniform buffer.

In most cases, the predefined nodes `objectGroup`, `renderGroup` and `frameGroup` will be used when defining the [UniformNode#groupNode](UniformNode.md#groupNode) property.

*   `objectGroup`: Uniform buffer per object.
*   `renderGroup`: Shared uniform buffer, updated once per render call.
*   `frameGroup`: Shared uniform buffer, updated once per frame.

## Constructor

### new UniformGroupNode( name : string, shared : boolean, order : number, updateType : string | null )

Constructs a new uniform group node.

**name**

The name of the uniform group node.

**shared**

Whether this uniform group node is shared or not.

Default is `false`.

**order**

Influences the internal sorting.

Default is `1`.

**updateType**

The update type of the uniform group node.

Default is `null`.

## Properties

### .isUniformGroup : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .name : string

The name of the uniform group node.

**Overrides:** [Node#name](Node.md#name)

### .order : number

The sort key that determines the order of this group relative to other uniform groups. Groups with a lower order are placed first. Shared groups typically use a lower order so they precede regular per-object groups.

Default is `1`.

### .shared : boolean

Whether this uniform group node is shared or not.

Default is `false`.

### .updateType : string | null

The update type of the uniform group node.

Default is `null`.

**Overrides:** [Node#updateType](Node.md#updateType)

## Methods

### .deserialize( data : Object )

Deserializes the uniform group node from a JSON object.

**data**

The object containing the serialized data.

**Overrides:** [Node#deserialize](Node.md#deserialize)

### .serialize( data : Object )

Serializes the uniform group node to a JSON object.

**data**

The object to store the serialized data.

**Overrides:** [Node#serialize](Node.md#serialize)

### .update()

Marks the uniform group node as needing an update. This will trigger the necessary updates in the rendering process.

**Overrides:** [Node#update](Node.md#update)

## Source

[src/nodes/core/UniformGroupNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/core/UniformGroupNode.js)
