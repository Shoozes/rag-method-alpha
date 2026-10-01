*Inheritance: EventDispatcher → Object3D → Scene →*

# RoomEnvironment

This class represents a scene with a basic room setup that can be used as input for [PMREMGenerator#fromScene](PMREMGenerator.md#fromScene). The resulting PMREM represents the room's lighting and can be used for Image Based Lighting by assigning it to [Scene#environment](Scene.md#environment) or directly as an environment map to PBR materials.

The implementation is based on the [EnvironmentScene](https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/three-components/EnvironmentScene.ts) component from the `model-viewer` project.

## Code Example

```js
const environment = new RoomEnvironment();
const pmremGenerator = new THREE.PMREMGenerator( renderer );
const envMap = pmremGenerator.fromScene( environment ).texture;
scene.environment = envMap;
```

## Import

RoomEnvironment is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
```

## Constructor

### new RoomEnvironment()

## Methods

### .dispose()

Frees internal resources. This method should be called when the environment is no longer required.

**Overrides:** [Scene#dispose](Scene.md#dispose)

## Source

[examples/jsm/environments/RoomEnvironment.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/environments/RoomEnvironment.js)
