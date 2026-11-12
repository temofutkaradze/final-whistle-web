# Additional News Telegram templates

Upload a background Photo or JPEG/JPG/PNG/WebP document to the connected **News Post** bot. Choose **Headline + Subtitle**, **Large Headline**, **NEWS (Red)** or **DID YOU KNOW (Yellow)** from its keyboard. Enter the headline, then the subtitle when requested. Wrap text in `*asterisks*` for yellow highlighting, including across line breaks. The result uses the existing high-quality JPEG document exporter.

These are optional: ignoring the keyboard and sending a circle photograph or the existing `Author | quote` text preserves the original workflow. BREAKING, Standings, custom styling and account connections are unchanged. `/cancel` clears the current collection. Text templates use the full uploaded background through the existing lossless orientation-normalization path, a deterministic centered cover fit, embedded fonts and no AI cropping/upscaling. Red and yellow frames both use 2 canonical pixels.

No migration, additional dependency, credential change or new service is needed. Start the existing `start-system.bat` manually to load the updated News manager and renderer; this change does not start them.
