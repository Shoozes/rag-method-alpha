# Bitangent

Bitangent nodes provide access to surface bitangent vectors at different transformation stages. In TSL, these values are mapped to specific [Coordinate Spaces](#coordinate-spaces) (Geometry, Local, World, or View). Together with normals and tangents, they complete the three-dimensional local coordinate basis (TBN) at the surface of the geometry.

<code name="bitangentExample" default="true">Vertical Anisotropic Glow</code>

::: api bitangentGeometry : vec3 - Normalized bitangent in geometry space. :::

::: api bitangentLocal : vec3 - Normalized bitangent in local space. :::

::: api bitangentView : vec3 - Normalized transformed bitangent in view space. :::

::: api bitangentWorld : vec3 - Normalized transformed bitangent in world space. :::

```tsl bitangentExample
import 'scenes/shaderball';
import * as THREE from 'three';
import { bitangentView, positionViewDirection, color } from 'three/tsl';

// Calculate alignment between view-space bitangents and view direction
const alignment = bitangentView.dot( positionViewDirection ).abs();
const edgeGlow = alignment.pow( 4.0 ); // Concentrated highlight on the top and bottom edges

// Mix a dark background with a glowing warm gold directional highlight
model.material = new THREE.NodeMaterial();
model.material.colorNode = edgeGlow.mix( color( 0x0a0603 ), color( 0xffaa00 ) );
```
