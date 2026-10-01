# PersonGenerator

A low-poly pedestrian crowd with shaped heads, jackets and lofted limbs. Two shared poses stand or walk, with sleeves and trousers swept through their joints. Each placement gets deterministic proportions and a small seed attribute for its complexion, hairstyle and outfit, in two instanced draws.

The material splits the figure into zones on a baked `partId` and hashes the seed per zone, drawing clothes, skin and hair from small palettes. Local UVs keep facial features, cuffs and shoe soles attached to their parts as the figure is posed.

The canonical figure stands on `y = 0`, centred in X / Z and ~1.75 m tall, facing `+Z` so a placement turns it to face the road.

## Code Example

```js
const people = new PersonGenerator();
scene.add( people.build( placements ) ); // placements: Matrix4[]
```

## Constructor

### new PersonGenerator()

## Source

[examples/jsm/generators/city/PersonGenerator.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/generators/city/PersonGenerator.js)
