# Sources, licences and attribution

Nothing in this repository's anatomy is original work. Every mesh, every FMA
identifier and every group membership came from a published dataset, and this
file says which, under what terms, and what was changed. It is the file to read
before redistributing anything from here.

## BodyParts3D — the body

> BodyParts3D, © The Database Center for Life Science licensed under
> CC Attribution 4.0 International.

- **What it is:** the skeleton, both muscle layers, the organs, the arteries,
  the veins, the airways and ducts, the cartilages and ligaments, the cranial
  nerves and the heart valves — 1,063 of the 1,083 structures in
  `web/src/generated/structures.json`, and 14 of the GLB files under
  `web/models/`.
- **Licence:** [CC BY 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
  The sentence quoted above is the licensor's own required wording, not a
  paraphrase.
- **Geometry, release 3.0:** BodyParts3D/Anatomography release 3.0 (20110915),
  the 99% polygon-reduction set — 934 meshes, one per FMA concept with the two
  sides of a paired structure in one file. This is the taught body: the bones,
  the muscles and the viscera a class is cued out of.
- **Geometry, release 4.0:** the IS-A element archive published at `LATEST`
  (`isa_BP3D_4.0_obj_99.zip`) — the same body cut into 2,234 element files, one
  per piece and sided. `web/scripts/build_detail.py` builds from it the layers
  release 3.0 does not carry at all: the arterial and venous trees, the
  tracheobronchial and biliary trees, the cranial nerves, the cartilages and
  the heart valves. Both releases are in one frame at one scale, which is
  measured rather than assumed — femur and liver from each agree to within a few
  millimetres.

  An earlier version of this file said no 4.0 mesh was used, downloaded or
  redistributed. That was true when it was written and is not true now; it is
  corrected here rather than quietly replaced, because a licence notice that has
  ever been wrong is worth being able to see the history of.
- **Concept hierarchy:** the IS-A and PART-OF inclusion tables published at
  `LATEST`, which is release 4.0. These are FMA-to-FMA and carry no geometry.
  They are also what joins an element file to the structure it is a piece of:
  `isa_element_parts.txt` maps each `FJ####.obj` to every concept above it, and
  the build takes the most specific one.
- **Citation:** Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K.
  BodyParts3D: 3D structure database for anatomical concepts.
  *Nucleic Acids Research* 2009;37(Database issue):D782–5.
- **Where to get it:** <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>

### About the older share-alike notice

The OBJ files inside the release-3.0 archive carry a comment reading
*CC Attribution-Share Alike 2.1 Japan*, and this project quoted that in its data
files, its build scripts and its About panel for a long time. It is out of date:
the licensor's own licence page offers the database under CC BY 4.0 and specifies
the attribution sentence above.

This is recorded rather than quietly deleted, because "the licence turned out to
be less restrictive than we said" is exactly the kind of claim that should be
checkable by whoever reads it next. The grant received under 2.1 Japan is not
revoked by the newer offer; the newer offer is simply the one the licensor now
makes and the one this project relies on.

### What was changed

- Millimetres in the archive's own axes converted to a canonical frame — +X left,
  +Y superior, +Z anterior — then to a body-height unit where standing height is
  1.0 and the origin is the ASIS midpoint (`web/scripts/derive_frame.py`).
- Decimated per structure, with a triangle budget that varies by structure, in
  Python rather than by a mesh simplifier, so the per-vertex region id stays an
  exact integer (`web/scripts/glb_common.py`).
- Grouped into six layer GLBs, with each structure's local region id baked as a
  per-vertex attribute.
- An envelope shell derived from the structures themselves by voxelisation
  (`web/scripts/build_shell.py`). It is computed from BodyParts3D geometry and
  carries the same licence.
- Skinning weights fitted against a rig, so the meshes deform through poses.
- Names normalised; the FMA identifier each structure arrived with is preserved
  unchanged, which is what makes the grouping in the next section possible.

## Z-Anatomy — the peripheral nervous system

> Z-Anatomy by Gauthier Kervyn and Marcin Zielinski, licensed CC BY-SA 4.0,
> derived from BodyParts3D.

- **What it is:** all 20 structures in the `nervous` layer — the named peripheral
  nerves, the plexuses, the spinal cord and the sympathetic trunk — and
  `web/models/nervous.glb`.
- **Licence:** **CC BY-SA 4.0**. This is a real share-alike and it is the one
  genuine copyleft obligation in this repository: anything redistributed that
  incorporates these meshes carries CC BY-SA 4.0, whatever the rest of the atlas
  is under.
- **Where to get it:** <https://github.com/Z-Anatomy/The-blend>
- **What was changed:** bevelled curves in a Blender file converted to meshes and
  registered onto the BodyParts3D body by a similarity fit over eight shared
  bones; residual 7.12 mm (`web/scripts/build_nervous.py`).

## The brain

- **fsaverage cortical surface** with the Desikan-Killiany parcellation, and
  subcortical structures marching-cubed from `aseg.mgz` (FreeSurfer).
- Fischl B et al., *Neuron* 2002;33(3):341–55.
- Desikan RS et al., *NeuroImage* 2006;31(3):968–80.

## OpenSim — the rig and the muscle paths

- The Rajagopal 2016 model, Apache-2.0.
  <https://github.com/opensim-org/opensim-models>

## Human Atlas — one idea and two algorithms

<https://github.com/ashemag/human-atlas>, MIT licensed, © 2026 ashemag.

No geometry, no manifest and no data file is taken from that repository. What was
taken is named here so the credit is on the record:

- **The idea of using the FMA concept hierarchy as a selection layer.** That
  project ships a 3,432-concept manifest and lets a reader select a concept
  rather than a mesh. This one now does the same thing, derived independently
  from the licensor's own published tables (`web/scripts/build_groups.py`) so
  that the anatomy data has one source rather than two.
- **`PointerTap`** — telling a tap from an orbit, a pinch, a pan and a cancelled
  touch sequence, per pointer id. Ported under MIT; the notice travels with it in
  `web/src/pointerTap.js`.

`docs/atlas-audit.md` is the full read of both repositories, including what was
looked at and rejected.

## This repository's own work

The application code, the exercise library, the muscle and nerve descriptions,
the evidence tiers, the rig fitting, the session layer and the measurement
pipeline. Written here, and — unlike the anatomy — not claimed to be anyone
else's.

The muscle and nerve descriptions cite Gray's *Anatomy* 42nd edition and Moore's
*Clinically Oriented Anatomy* 8th edition as references; the text is written
rather than reproduced.
