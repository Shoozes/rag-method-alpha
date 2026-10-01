# Coordinate Spaces

TSL provides dedicated accessor nodes to query geometric properties — such as positions, normals, tangents, and bitangents — across each stage of the GPU transformation pipeline.

Understanding coordinate spaces is essential for procedural shading, lighting calculations, triplanar texturing, normal mapping, and view-dependent effects.

### MVP Pipeline (Model - View - Projection)

The standard rendering pipeline transforms vertex positions forward through **Model**, **View**, and **Projection** matrices:

```mermaid
flowchart LR
	Geom["<b>Geometry</b><br/><small><code>positionGeometry</code><br/>Raw Buffer</small>"]
	Local["<b>Local</b><br/><small><code>positionLocal</code><br/>Object Center<br/>Skinning & Morphing</small>"]
	World["<b>World</b><br/><small><code>positionWorld</code><br/>Global Scene</small>"]
	View["<b>View</b><br/><small><code>positionView</code><br/>Camera Eye</small>"]
	Clip["<b>Clip</b><br/><small><code>modelViewProjection</code><br/>Projected Clip</small>"]

	Geom --> Local
	Local --> World
	World --> View
	View --> Clip
```

### Coordinate Spaces Overview

| Space | Origin | Description & Use Cases |
| :--- | :--- | :--- |
| **Geometry** | Raw buffer | Raw, unmodified vertex attribute buffer before any CPU or GPU transformations. Ideal for rest-pose computations and base coordinate derivations. |
| **Local (Object)** | Mesh object | Object-space coordinates after applying GPU transformations (skeletal skinning, blend shapes, morph targets). Used for procedural textures that transform with the mesh. |
| **World** | Scene global | Global scene coordinates. Essential for scene lighting, shadow projections, world-space reflections, triplanar mapping, and cross-object interactions. |
| **View (Camera)** | Active camera eye position | Coordinates relative to the camera eye. Essential for Fresnel edge glow, view-dependent specular highlights, matcaps, and camera distance effects. |
