# Fog

Functions for creating fog effects in the scene. Assign the fog node to `scene.fogNode`.

<code name="volumetricFog" default="true">Volumetric Fog</code>

::: api scene.fogNode : Node - Assign a node to control the scene's fog effect. :::

::: api fog( color, factor ) : FogNode - Creates a fog node with specified color and fog factor.
- **color**: `Node | Color | string` - Color node or value for the fog.
- **factor**: `Node` - Fog factor node determining fog density or falloff (e.g. `rangeFogFactor`, `densityFogFactor`).
:::

::: api rangeFogFactor( near?, far? ) : float - Creates a linear fog factor based on distance from camera.
- **near**: `Node | number` - (Optional) Distance from camera where fog begins. Defaults to camera near plane.
- **far**: `Node | number` - (Optional) Distance from camera where fog reaches maximum density. Defaults to camera far plane.
:::

::: api densityFogFactor( density? ) : float - Creates an exponential squared fog factor for denser fog.
- **density**: `Node | number` - (Optional) Fog density coefficient. Defaults to `0.00025`.
:::

::: api exponentialHeightFogFactor( density?, height? ) : float - Creates an exponential height fog factor below a specified world height.
- **density**: `Node | number` - (Optional) Fog density coefficient. Defaults to `0.00025`.
- **height**: `Node | number` - (Optional) World-space height threshold for exponential falloff. Defaults to `0.0`.
:::

```tsl volumetricFog
import 'scenes/shaderball';
import { fog, positionWorld, cameraPosition, float, color } from 'three/tsl';

// Volumetric Fog Parameters (Beer-Lambert Law)
const groundDensity = float( 1.00 ); // Base ground fog density (m⁻¹)
const heightFalloff = float( 1.25 ); // Exponential height scale
const fogGroundHeight = float( 0.0 ); // Ground height Y
const atmosphericHaze = float( 0.02 ); // Uniform background haze density

// 1. Ray vector from camera to fragment
const ray = positionWorld.sub( cameraPosition );
const rayLength = ray.length();
const dy = ray.y; // Vertical delta (P_y - C_y)

// 2. Camera-level ground fog density: g0 * exp( -heightFalloff * (C_y - fogGroundHeight) )
const cameraHeightOffset = cameraPosition.y.sub( fogGroundHeight );
const cameraDensity = groundDensity.mul( heightFalloff.negate().mul( cameraHeightOffset ).exp() );

// 3. Analytical integration of optical depth along the ray path
const x = dy.mul( heightFalloff );
const safeX = x.abs().lessThan( 0.001 ).select( float( 1.0 ), x );
const expr = float( 1.0 ).sub( x.negate().exp() ).div( safeX );
const integratedHeight = x.abs().lessThan( 0.001 ).select( float( 1.0 ).sub( x.mul( 0.5 ) ), expr );

// Ground fog optical depth + uniform atmospheric haze optical depth
const groundOpticalDepth = cameraDensity.mul( integratedHeight ).mul( rayLength ).max( 0.0 );
const atmosphericOpticalDepth = atmosphericHaze.mul( rayLength );
const totalOpticalDepth = groundOpticalDepth.add( atmosphericOpticalDepth );

// 4. Transmittance & fog factor according to Beer-Lambert Law: F = 1 - exp( -totalOpticalDepth )
const fogFactor = totalOpticalDepth.negate().exp().oneMinus();

const fogColor = color( 0x06b6d4 );
scene.fogNode = fog( fogColor, fogFactor );
scene.backgroundNode = fogColor.mul( 6.7 );

model.material.colorNode = color( 0xffaa00 );
```
