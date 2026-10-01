*Inheritance: EventDispatcher → Node →*

# ContextNode

This node can be used as a context management component for another node. [NodeBuilder](NodeBuilder.md) performs its node building process in a specific context and this node allows the modify the context. A typical use case is to overwrite `getUV()` e.g.:

## Code Example

```js
node.context( { getUV: () => customCoord } );
\// or
material.contextNode = context( { getUV: () => customCoord } );
\// or
renderer.contextNode = context( { getUV: () => customCoord } );
\// or
scenePass.contextNode = context( { getUV: () => customCoord } );
```

## Constructor

### new ContextNode( node : Node, value : Object )

Constructs a new context node.

**node**

The node whose context should be modified.

Default is `null`.

**value**

The modified context data.

Default is `{}`.

## Properties

### .isContextNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .node : Node

The node whose context should be modified.

### .value : Object

The modified context data.

Default is `{}`.

## Methods

### .generateNodeType( builder : NodeBuilder ) : string

This method is overwritten to ensure it returns the type of [ContextNode#node](ContextNode.md#node).

**builder**

The current node builder.

**Overrides:** [Node#generateNodeType](Node.md#generateNodeType)

**Returns:** The node type.

### .getFlowContextData() : Object

Gathers the context data from all parent context nodes.

**Returns:** The gathered context data.

### .getMemberType( builder : NodeBuilder, name : string ) : string

This method is overwritten to ensure it returns the member type of [ContextNode#node](ContextNode.md#node).

**builder**

The current node builder.

**name**

The member name.

**Overrides:** [Node#getMemberType](Node.md#getMemberType)

**Returns:** The member type.

### .getScope() : Node

This method is overwritten to ensure it returns the reference to [ContextNode#node](ContextNode.md#node).

**Overrides:** [Node#getScope](Node.md#getScope)

**Returns:** A reference to [ContextNode#node](ContextNode.md#node).

## Source

[src/nodes/core/ContextNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/core/ContextNode.js)
