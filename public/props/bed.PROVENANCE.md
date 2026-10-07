# bed.glb — provenance

- **Model:** Cute stylized bed - low poly - game ready
- **Author:** Pricey — https://sketchfab.com/siddharthkuthal
- **Source:** https://sketchfab.com/3d-models/cute-stylized-bed-low-poly-game-ready-fc53375324f64ba3aff9c25a81dae6f7
- **License:** Creative Commons Attribution 4.0 — http://creativecommons.org/licenses/by/4.0/

The license requires attribution: credit the author and link the source and
the license wherever the model is distributed.

## Modifications

`bed.glb` is a modified version of the original model.

- Scaled to 2.41 m long, then lowered to 0.64 of its height so that the top of
  the blanket at the near edge is 0.52 m above the floor, the seat height of
  `public/motions/bed_wake.vrma`.
- The orange round cushion sits on the far side of the pillow area.
- The two blanket meshes (`Plane.001_Material_0`, `Plane.003_Material_0`) are
  subdivided.
- The origin is the spot on the floor where the character stands at the end of
  `bed_wake`, in front of the near edge. `bed_sleep` and `bed_wake` keep their
  horizontal root motion in this same frame, so the bed is placed at the
  character's position with no further alignment. Sizes are for a character
  whose rest hips height is 0.9 m.
