# bed.glb — provenance

- **Model:** Cute stylized bed - low poly - game ready
- **Author:** Pricey — https://sketchfab.com/siddharthkuthal
- **Source:** https://sketchfab.com/3d-models/cute-stylized-bed-low-poly-game-ready-fc53375324f64ba3aff9c25a81dae6f7
- **License:** Creative Commons Attribution 4.0 — http://creativecommons.org/licenses/by/4.0/

The license requires attribution: credit the author and link the source and
the license wherever the model is distributed.

## Modifications

`bed.glb` is a modified version of the original model.

- Scaled to 2.41 m long, centred on the origin, legs on the ground plane.
- The orange round cushion sits on the far side of the pillow area.
- The two blanket meshes (`Plane.001_Material_0`, `Plane.003_Material_0`) are
  subdivided and carry an `occupied` morph target: at weight 0 the blanket has
  its original flat shape, at weight 1 it bulges over a character lying under
  it for the whole length of `public/motions/sleeping.vrma`.
- An empty node `anchor_lie` marks where the character's root sits while she
  lies in the bed: 0.66 m above the ground plane, on the mattress top.
