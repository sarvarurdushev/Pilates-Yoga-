#!/usr/bin/env bash
# Downloads the FreeSurfer source data the model pipeline is built from.
# You do NOT need this to run or deploy the app — only to rebuild the brain itself.
#
#   fsaverage surfaces + Desikan-Killiany atlas -> cortex
#   aseg.mgz                                    -> cerebellum, brainstem, subcortical
#
# Mirrored in mne-testing-data because the primary hosts (nitrc.org, osf.io) block
# scripted downloads. Same files, same checksums as a FreeSurfer install.
set -euo pipefail
DEST="${1:-./fsdata}"
BASE="https://raw.githubusercontent.com/mne-tools/mne-testing-data/master/subjects/fsaverage"
mkdir -p "$DEST"
echo "downloading into $DEST"
for f in surf/lh.white surf/rh.white surf/lh.curv surf/rh.curv \
         label/lh.aparc.annot label/rh.aparc.annot mri/aseg.mgz; do
  out="$DEST/$(basename "$f")"
  if [ -s "$out" ]; then echo "  have $(basename "$f")"; continue; fi
  echo "  $(basename "$f")"
  curl -fsSL --retry 3 -o "$out" "$BASE/$f"
done
echo
echo "done. rebuild with:"
echo "  pip install nibabel scikit-image scipy fast-simplification numpy"
echo "  python3 scripts/build_cortex.py      $DEST public/models/cortex.glb"
echo "  python3 scripts/build_subcortical.py $DEST/aseg.mgz public/models"
echo "  cp -r public/models models"
echo "  node scripts/build-standalone.mjs      # optional single-file build"
