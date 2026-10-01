# ForestGenerator

Carpets a [TerrainGenerator](TerrainGenerator.md) with trees in a single instanced draw call. Each tree is a distorted icosphere with a baked crown gradient. Altitude, slope and a density mask control placement; rotation and scale vary between trees.

Compatible terrain objects expose `sampleHeight`, `sampleSlope`, `minY`, `maxY` and `parameters.size`.

## Code Example

```js
const forest = new ForestGenerator( { count: 500000 } );
scene.add( forest.build( terrain ) );
```

## Constructor

### new ForestGenerator()

## Source

[examples/jsm/generators/ForestGenerator.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/generators/ForestGenerator.js)
