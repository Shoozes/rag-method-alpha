# MRT

**MRT** (Multiple Render Targets) allows a single render pass to output to multiple render target textures simultaneously from a single fragment shader execution.

This is essential for deferred rendering pipelines, G-Buffer generation, and advanced screen-space post-processing effects (such as SSAO, SSR, SSGI, Motion Blur, Bloom, and selective masks) without rendering the scene geometry multiple times.

<code name="splitView" default="true">Color, Normals and Positions</code>

::: api mrt( outputNodes ) : MRTNode - Creates a Multiple Render Target (MRT) node mapping named targets to node expressions.
- **outputNodes**: `Object<string, Node>` - Dictionary mapping output attachment names (e.g., `output`, `normal`, `position`, `mask`) to their corresponding node expressions.
:::

::: api pass.setMRT( mrtNode ) - Configures a render pass to output to Multiple Render Targets. :::

::: api pass.getTextureNode( name ) : TextureNode - Retrieves the texture node corresponding to a named MRT output attachment from the pass. :::

### Material-Level MRT

::: api material.mrtNode - Assigns a custom MRT node directly to a material to override or append specific output attachments. :::

In addition to setting MRT on the render pass, individual materials can define their own `material.mrtNode` to output custom data (such as selective bloom masks, object IDs, or custom depth) into separate attachments:

```js
// This material outputs a custom glow mask into the 'mask' attachment
glowMaterial.mrtNode = mrt( {
	mask: output
} );
```

```tsl splitView
import 'scenes/shaderball';
import { pass, mrt, output, normalWorld, positionWorld, screenUV, step, mix } from 'three/tsl';

// 1. Create a scene render pass
const scenePass = pass( scene, camera );

// 2. Configure the pass to output Color, World Normals, and World Positions simultaneously via MRT
scenePass.setMRT( mrt( {
	output: output,
	normal: normalWorld,
	position: positionWorld
} ) );

// 3. Retrieve individual MRT texture attachments
const colorTexture = scenePass.getTextureNode( 'output' );
const normalTexture = scenePass.getTextureNode( 'normal' );
const positionTexture = scenePass.getTextureNode( 'position' );

// 4. Display split-screen (Left: Color / Center: World Normals / Right: World Positions)
let splitScreen = colorTexture;
splitScreen = mix( splitScreen, normalTexture, step( 0.333, screenUV.x ) );
splitScreen = mix( splitScreen, positionTexture, step( 0.666, screenUV.x ) );

// const renderPipeline = new THREE.RenderPipeline();
renderPipeline.outputNode = splitScreen;
```
