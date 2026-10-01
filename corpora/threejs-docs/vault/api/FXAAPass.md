*Inheritance: Pass → ShaderPass →*

# FXAAPass

A pass for applying FXAA.

## Code Example

```js
const fxaaPass = new FXAAPass();
composer.addPass( fxaaPass );
```

## Import

FXAAPass is an addon, and must be imported explicitly, see [Installation#Addons](https://threejs.org/manual/#installation#addons).

```js
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
```

## Constructor

### new FXAAPass()

Constructs a new FXAA pass.

## Methods

### .setSize( width : number, height : number )

Sets the size of the pass.

**width**

The width to set.

**height**

The height to set.

**Overrides:** [ShaderPass#setSize](ShaderPass.md#setSize)

## Source

[examples/jsm/postprocessing/FXAAPass.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/postprocessing/FXAAPass.js)
