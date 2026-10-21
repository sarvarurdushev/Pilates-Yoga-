# Synthetic test clips

These three files exist only to prove that the SEDENS room player plays real local MP4 and WebM files
(`web/test/sedens-room-media.browser.mjs`) and that the media upload and import checks accept real
containers (`tests/test_sedens_media_import.py`).

| File | Container and codec | Size | What it is |
|---|---|---|---|
| `sedens-test-pattern-a.mp4` | MP4, H.264 (baseline), no audio | about 46 KB | FFmpeg `testsrc2` pattern with a moving frame counter, 4 s, 320x180, 15 fps |
| `sedens-test-pattern-b.webm` | WebM, VP9, no audio | about 15 KB | FFmpeg `testsrc` pattern, hue-shifted, 4 s, 320x180, 15 fps |
| `sedens-test-pattern-c-vp9.mp4` | MP4 container, VP9, no audio | about 61 KB | FFmpeg `testsrc2` pattern, hue-shifted, 4 s, 320x180, 15 fps |

Why three: the MP4 files are the format a creator is most likely to upload. The Chromium build that the
browser tests run in (Playwright's open-source Chromium) has **no H.264 decoder**
(`canPlayType('video/mp4; codecs="avc1.42E01E"')` is empty), but plays VP8, VP9 and AV1. File `a` is the
H.264 MP4: the browser test uploads it and checks that the server serves it byte for byte in ranges, and
plays it when the browser can decode H.264. File `c` is the same MP4 container with VP9, so the real
player is proven to play an `.mp4` file in a browser without H.264. File `b` is the WebM.

- They are **synthetic test patterns generated in this repository**. They show colour bars, shapes and
  a counter. There is **no person, no exercise, no movement and no audio** in them.
- They were made from nothing: no third-party footage, music or image went into them. They are the
  repository's own work, covered by the licence the repository carries (README, "Licensing"), and
  nobody else has a claim on them.
- Each shows the words "TEST PATTERN ... - NOT AN EXERCISE" in the frame.
- They must **never** be shown as an exercise demonstration, listed in `data/content_sources.json`,
  registered as media of a SEDENS Standard exercise or copied under `web/assets/`. The browser test
  uses them only in a temporary demonstration course, where a step names a Standard exercise.
  They are not stock footage and are not imported through `media_import`.

## How they were made

FFmpeg 6.1.1 with `libx264`, `libvpx-vp9` and `drawtext` (DejaVu Sans Bold). Run from this folder:

```sh
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf

ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=15:duration=4" \
  -vf "drawtext=fontfile=$F:text='TEST PATTERN A - NOT AN EXERCISE':fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=h-24" \
  -an -c:v libx264 -profile:v baseline -pix_fmt yuv420p -preset veryslow -crf 30 -movflags +faststart \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact sedens-test-pattern-a.mp4

ffmpeg -y -f lavfi -i "testsrc=size=320x180:rate=15:duration=4" \
  -vf "drawtext=fontfile=$F:text='TEST PATTERN B - NOT AN EXERCISE':fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=h-24,hue=h=120" \
  -an -c:v libvpx-vp9 -b:v 0 -crf 40 -pix_fmt yuv420p -row-mt 1 \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact sedens-test-pattern-b.webm

ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=15:duration=4" \
  -vf "drawtext=fontfile=$F:text='TEST PATTERN C - NOT AN EXERCISE':fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-text_w)/2:y=h-24,hue=h=240" \
  -an -c:v libvpx-vp9 -b:v 0 -crf 40 -pix_fmt yuv420p -row-mt 1 -movflags +faststart \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact sedens-test-pattern-c-vp9.mp4
```

Another FFmpeg build may produce slightly different bytes; the checksums below belong to the committed
files, and no test depends on them.

```
3f341062a21db6423eef76dabc4daf74bf8f0544e3f2ecb6b6e67ee57ed28021  sedens-test-pattern-a.mp4
9b33d06a9def00c2e003e342b14680aefb849b0ebc02aee12e9fb1d916359563  sedens-test-pattern-b.webm
40edba554461a2db19b1a73e66a63576330db3f0f7038ed0199ab1e2c263821b  sedens-test-pattern-c-vp9.mp4
```

Check the codecs with `ffprobe -v error -show_entries stream=codec_name,width,height -of compact <file>`.
