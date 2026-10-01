# Tangent

Tangent nodes provide access to surface tangent vectors at different transformation stages. In TSL, these values are mapped to specific [Coordinate Spaces](#coordinate-spaces) (Geometry, Local, World, or View) to allow precise control over normal mapping, anisotropic reflections, and local coordinate orientation.

<code name="tangentExample" default="true">Anisotropic Directional Glow</code>

::: api tangentGeometry : vec4 - Tangent attribute of geometry. :::

::: api tangentLocal : vec3 - Local variable for tangent. :::

::: api tangentView : vec3 - Normalized transformed view tangent. :::

::: api tangentWorld : vec3 - Normalized transformed world tangent. :::

```tsl tangentExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { tangentView, positionViewDirection, color } from 'three/tsl';

// Calculate alignment between view-space tangents and view direction
const alignment = tangentView.dot( positionViewDirection ).abs();
const edgeGlow = alignment.pow( 4.0 ); // Concentrated highlight on the left and right edges

// Mix a dark background with a glowing neon purple directional highlight
model.material = new THREE.NodeMaterial();
model.material.colorNode = edgeGlow.mix( color( 0x070c1b ), color( 0xbd00ff ) );
```
