*Inheritance: EventDispatcher → Node →*

# BypassNode

The class generates the code of a given node but returns another node in the output. This can be used to call a method or node that does not return a value, i.e. type `void` on an input where returning a value is required. Example:

## Code Example

```js
material.colorNode = myColor.bypass( runVoidFn() )
```

## Constructor

### new BypassNode( outputNode : Node, callNode : Node )

Constructs a new bypass node.

**outputNode**

The output node.

**callNode**

The call node.

## Properties

### .callNode : Node

The call node.

### .isBypassNode : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .outputNode : Node

The output node.

## Source

[src/nodes/core/BypassNode.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/nodes/core/BypassNode.js)
