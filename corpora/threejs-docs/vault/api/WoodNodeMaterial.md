# WoodNodeMaterial

Procedural wood material using TSL (Three.js Shading Language).

Usage examples:

// Using presets (recommended for common wood types) const material = WoodNodeMaterial.fromPreset('walnut', 'gloss');

// Using custom parameters (for advanced customization) const material = new WoodNodeMaterial({ centerSize: 1.2, ringThickness: 1/40, darkGrainColor: new THREE.Color('#2a1a0a'), lightGrainColor: new THREE.Color('#8b4513'), clearcoat: 1, clearcoatRoughness: 0.3 });

// Mixing presets with custom overrides const walnutParams = GetWoodPreset('walnut', 'raw'); const material = new WoodNodeMaterial({ ...walnutParams, ringThickness: 1/50, // Override specific parameter clearcoat: 1 // Add finish });

## Constructor

### new WoodNodeMaterial()

## Classes

[WoodNodeMaterial](WoodNodeMaterial.md)

## Source

[examples/jsm/materials/WoodNodeMaterial.js](https://github.com/mrdoob/three.js/blob/1a1c86699f9c38d4bef1cf51652e5f0e0680d745/examples/jsm/materials/WoodNodeMaterial.js)
