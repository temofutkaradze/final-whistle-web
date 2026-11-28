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

## Competition markers added for expanded Match coverage

- `3.svg`: white trophy-only Europa League marker, in the shared logo box. It is a self-contained geometric trace of the trophy-only reference supplied with the task; it omits the UEFA/Europa League wordmark. The reference silhouette is also documented as a simple geometric representation at [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:PD-Shape_Europa_League_Trophy.svg).
- `253.svg`: white MLS shield with MLS letters, three stars, and diagonal slash, traced as self-contained vector paths from the supplied reference. The crest design/source is attributed to Major League Soccer in [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MLS_crest_logo_CMYK.svg).
- `10.svg`: a simple white globe/world silhouette used only for Argentina or Brazil international friendlies; it is a generic local vector symbol, not a competition trademark.

All three SVGs use transparent backgrounds and only local vector geometry: no scripts, external references, embedded raster images, or filters. Runtime validation checks them with the existing SVG resource validator. Rendered icons use `object-fit: contain` with optical boxes of 40×72 (trophy), 64×56 (MLS), and 56×56 (globe); they receive no shadow/filter effect. The renderer's existing 72×56 logo dimensions for all established competitions are unchanged.
