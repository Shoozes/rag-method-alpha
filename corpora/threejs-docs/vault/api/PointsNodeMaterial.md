*Inheritance: EventDispatcher → Material → NodeMaterial → SpriteNodeMaterial →*

# PointsNodeMaterial

Node material version of [PointsMaterial](PointsMaterial.md).

This material can be used in two ways:

*   By rendering point primitives with [Points](Points.md). Since WebGPU only supports point primitives with a pixel size of `1`, it's not possible to define a size.

```js
const pointCloud = new THREE.Points( geometry, new THREE.PointsNodeMaterial() );
```

*   By rendering point primitives with Sprites. In this case, size is honored, see [PointsNodeMaterial#sizeNode](PointsNodeMaterial.md#sizeNode).

```js
const instancedPoints = new THREE.Sprite( new THREE.PointsNodeMaterial( { positionNode: instancedBufferAttribute( positionAttribute ) } ) );
```

## Constructor

### new PointsNodeMaterial( parameters : Object )

Constructs a new points node material.

**parameters**

The configuration parameter.

## Properties

### .alphaToCoverage : boolean

Whether alpha to coverage should be used or not.

Default is `true`.

**Overrides:** [SpriteNodeMaterial#alphaToCoverage](SpriteNodeMaterial.md#alphaToCoverage)

### .isPointsNodeMaterial : boolean (readonly)

This flag can be used for type testing.

Default is `true`.

### .sizeNode : Node.<vec2>

This node property provides an additional way to set the point size.

Note that WebGPU only supports point primitives with 1 pixel size. Consequently, this node has no effect when the material is used with [Points](Points.md) and a WebGPU backend. If an application wants to render points with a size larger than 1 pixel, the material should be used with [Sprite](Sprite.md) and instancing.

Default is `null`.

## Source

[src/materials/nodes/PointsNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/src/materials/nodes/PointsNodeMaterial.js)
