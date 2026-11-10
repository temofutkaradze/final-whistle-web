# Reviewed league symbols

These runtime assets are separate, lossless crops; originals are not overwritten.
See provenance.json for exact source hashes and crop rectangles (before trimming
transparent padding). No AI reconstruction, recoloring, resizing or sharpening.

- 78 and 135: existing custom white transparent Bundesliga/Serie A assets.
- 2, 61 and 140: previously downloaded API-Football logo pixels; the renderer uses
  its normal white silhouette filter for these three, preserving alpha.
- Premier League requires no crop. Nations League is deliberately not cropped
  because its flag/pole and lettering do not have a clean transparent separation.

These are application runtime assets, not generated mock-match previews.
