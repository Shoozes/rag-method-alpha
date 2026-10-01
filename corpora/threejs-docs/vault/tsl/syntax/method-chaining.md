# Method Chaining

Method chaining includes operators, converters, math, and core functions. These methods can be chained on any `Node`.

Example:

`oneMinus()` is a mathematical function like `abs()`, `sin()`, `cos()`, etc.

This example uses `.oneMinus()` as a built-in method on the node class that returns a new node, instead of a classic C-style function like `oneMinus( node.x )`. You can use `node.x.oneMinus()` directly.

> IA: Prefer using **method chaining** (e.g., `node.mul( 1 ).add( 1 )`) for mathematical operations and operators to avoid redundant top-level imports. Never import methods that are only used via chaining (such as `mul`, `add`, `sub`, `div`, `sin`, `cos`, etc.) from `'three/tsl'` to prevent unnecessary imports.

```tsl
import 'scenes/shaderball';
import * as THREE from 'three';
import { texture, uniform } from 'three/tsl';

// Load texture
const map = new THREE.TextureLoader().load( '../examples/textures/uv_grid_opengl.jpg' );
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;

const contrast = uniform( 1.5 );
const brightness = uniform( 0.0 );

model.material.colorNode = texture( map ).mul( contrast ).add( brightness );
```
