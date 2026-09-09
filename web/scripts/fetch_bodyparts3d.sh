#!/usr/bin/env bash
# Fetches the BodyParts3D source archive into bpdata/ (gitignored).
#
# BodyParts3D, (c) The Database Center for Life Science, licensed under
# CC Attribution 4.0 International. https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
# Release 3.0 (20110915) for the geometry. The 99% polygon-reduction set is used: the 95%
# set is 547 MB and every part is decimated again by the build anyway, so the extra detail
# is thrown away. The concept tables come from LATEST, which is release 4.0 -- they are
# FMA-to-FMA and so join onto the 3.0 meshes unchanged. See ATTRIBUTION.md.
set -euo pipefail

BASE="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915"
LATEST_ELEM="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"
DIR="$(cd "$(dirname "$0")/.." && pwd)/bpdata"
mkdir -p "$DIR"

get() {
  local url="$1" out="$2"
  if [ -s "$out" ]; then echo "have $(basename "$out")"; return; fi
  echo "fetching $(basename "$out")"
  curl -fL --retry 4 --retry-delay 2 --max-time 1800 -o "$out.part" "$url"
  mv "$out.part" "$out"
}

get "$BASE/parts_list_e.txt"          "$DIR/parts_list_e.txt"
get "$BASE/conventional_part_of.txt"  "$DIR/conventional_part_of.txt"
get "$BASE/BodyParts3D_3.0_obj_99.zip" "$DIR/obj99.zip"

# The 4.0 element archive: the same body cut into 2,234 pieces rather than 934, sided, and
# carrying the arteries, veins, airways, biliary tree and cranial nerves that 3.0 has none
# of. scripts/build_detail.py turns it into the layers build_body.py does not build. The
# two releases are in one frame at one scale -- femur and liver from each agree to within
# a few millimetres.
get "$LATEST_ELEM/isa_BP3D_4.0_obj_99.zip" "$DIR/isa_obj99_40.zip"

# The 4.0 concept hierarchy, for scripts/build_groups.py. Six small text files, no meshes:
# the IS-A and PART-OF trees are parent-FMA to child-FMA, so they close over the ids the
# 3.0 meshes already carry without a single 4.0 mesh being downloaded or used.
LATEST="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"
for f in isa_parts_list_e.txt isa_inclusion_relation_list.txt isa_element_parts.txt \
         partof_parts_list_e.txt partof_inclusion_relation_list.txt partof_element_parts.txt; do
  get "$LATEST/$f" "$DIR/$f"
done

echo
echo "bpdata/ ready:"
ls -la "$DIR"

# ---------------------------------------------------------------------------------------
# The other two sources. Both are large and neither is redistributed here.
#
#   OpenSim — the Rajagopal 2016 model, for the rig and the muscle paths. Apache-2.0.
#   Z-Anatomy — the nerves, as bevelled curves in a 306 MB Blender file. CC BY-SA 4.0.
#             Reading it needs `pip install bpy`, which is about 2 GB.
OSIM_DIR="$DIR/osim"
if [ ! -s "$OSIM_DIR/Rajagopal2016.osim" ]; then
  echo "fetching the OpenSim model"
  tmp=$(mktemp -d)
  git clone --depth 1 --filter=blob:none --no-checkout \
    https://github.com/opensim-org/opensim-models "$tmp/osim"
  git -C "$tmp/osim" checkout HEAD -- Models/Rajagopal Geometry
  mkdir -p "$OSIM_DIR/Geometry"
  cp "$tmp/osim/Models/Rajagopal/Rajagopal2016.osim" "$OSIM_DIR/"
  cp "$tmp/osim"/Geometry/*.vtp "$OSIM_DIR/Geometry/" 2>/dev/null || true
  cp "$tmp/osim"/Models/Rajagopal/Geometry/*.vtp "$OSIM_DIR/Geometry/" 2>/dev/null || true
  rm -rf "$tmp"
fi

ZAN_DIR="$DIR/zanatomy"
if [ ! -s "$ZAN_DIR/Z-Anatomy/Startup.blend" ]; then
  echo "fetching the Z-Anatomy blend (86 MB compressed, 306 MB unpacked)"
  tmp=$(mktemp -d)
  git clone --depth 1 --filter=blob:none --no-checkout \
    https://github.com/Z-Anatomy/The-blend "$tmp/zan"
  git -C "$tmp/zan" checkout HEAD -- Z-Anatomy.zip
  mkdir -p "$ZAN_DIR"
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extract('Z-Anatomy/Startup.blend', sys.argv[2])" \
    "$tmp/zan/Z-Anatomy.zip" "$ZAN_DIR"
  rm -rf "$tmp"
fi

echo
echo "sources ready. Build order: build_body.py, parse_opensim.py, build_nervous.py"
