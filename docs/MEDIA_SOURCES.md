# Media sources and use notice

Last reviewed: 2026-11-10

## Project status

NITRO GRID is an unofficial, non-commercial security-awareness booth experience. It is not affiliated with, sponsored by, approved by, or endorsed by Formula 1, Formula One Management, the FIA, EA, the teams, the drivers, GIPHY, or their licensors.

The project operator has represented that this educational reuse is permitted and that the necessary reuse rights were checked before these assets were added. This repository records that project assumption; it is not an independent legal conclusion or a substitute for permission from the relevant rightsholders. If the distribution context changes, the operator must re-check the applicable permissions and replace or remove the third-party media when required.

No Formula 1 logo or team logo is included in the locally authored car illustrations. The four car SVGs are original NITRO GRID artwork that uses only general team-inspired color palettes.

The animated files under `src/public/assets/driver-panels/`, and any third-party names, likenesses, footage, or marks depicted in them, are excluded from the repository's MIT licence. Their use remains subject to the operator's stated permission basis and any applicable third-party terms. The locally authored NITRO GRID code and car SVGs remain covered by the repository licence.

## 2026 line-up references

Team and driver assignments were checked against the official Formula 1 line-up indexes:

- [Formula 1 — Teams](https://www.formula1.com/en/teams)
- [Formula 1 — Drivers](https://www.formula1.com/en/drivers)

The catalog snapshot used by the game is:

| Team | Drivers |
| --- | --- |
| Red Bull Racing | Max Verstappen #3; Isack Hadjar #6 |
| Ferrari | Charles Leclerc #16; Lewis Hamilton #44 |
| Mercedes | George Russell #63; Kimi Antonelli #12 |
| McLaren | Lando Norris #1; Oscar Piastri #81 |

Because sporting line-ups can change, re-check the official indexes before a later event build.

## Animated driver panels

The game serves local animated WebP copies of the following GIPHY-hosted clips. The links below are source and attribution records; listing them does not assert that every uploader is an official rights holder or that a GIPHY page alone grants a redistribution licence.

| Local file | Driver | Source page |
| --- | --- | --- |
| `src/public/assets/driver-panels/max-verstappen.webp` | Max Verstappen | [GIPHY source](https://giphy.com/gifs/redbullracing-f1-red-bull-racing-Irb20yXtA2QStkUnrE) |
| `src/public/assets/driver-panels/isack-hadjar.webp` | Isack Hadjar | [GIPHY source](https://giphy.com/gifs/f1-formula-1-formel-MI89BswFFetH9CbUwH) |
| `src/public/assets/driver-panels/charles-leclerc.webp` | Charles Leclerc | [GIPHY source](https://giphy.com/gifs/f1-ferrari-leclerc-charles-M9BLGQ8f2MvWVQZtTR) |
| `src/public/assets/driver-panels/lewis-hamilton.webp` | Lewis Hamilton | [GIPHY source](https://giphy.com/gifs/f1-ferrari-meme-CSoa7JDs8We3wrZcxZ) |
| `src/public/assets/driver-panels/george-russell.webp` | George Russell | [GIPHY source](https://giphy.com/gifs/f1-formula-1-formel-BvcNdKvRPwzv09HJVI) |
| `src/public/assets/driver-panels/kimi-antonelli.webp` | Kimi Antonelli | [GIPHY source](https://giphy.com/gifs/f1-formula1-kimiantonellimercedes-kTCZt1IIMXYmHVoNFj) |
| `src/public/assets/driver-panels/lando-norris.webp` | Lando Norris | [GIPHY source](https://giphy.com/gifs/f1-formula-1-aishi-YDUaNBTTy1GdNSZZRe) |
| `src/public/assets/driver-panels/oscar-piastri.webp` | Oscar Piastri | [GIPHY source](https://giphy.com/gifs/f1-formula-1-formel-xhTa2oPQNeJ2596Z9t) |

Direct delivery copies were retrieved from `https://i.giphy.com/media/{id}/giphy.webp`, using the media identifier at the end of each source-page URL, except for the two same-item rendition cases below:

- Charles Leclerc uses `https://i.giphy.com/media/M9BLGQ8f2MvWVQZtTR/200_d.webp`, GIPHY's animated downsampled rendition for that media ID. At retrieval it was 356×200, 6 frames, and 112,624 bytes. It replaces the same item's 480×270, 175-frame, 4,282,020-byte `giphy.webp` rendition to reduce mobile loading cost.
- The designated Lewis Hamilton `giphy.webp` rendition was a single frame, so the animated `giphy-downsized.gif` rendition from the same media ID was converted locally to animated WebP.

No content from a different GIPHY item was substituted in either case.

## Original car artwork

These files were created for NITRO GRID and do not copy a team badge or Formula 1 logo:

- `src/public/assets/cars/red-bull-racing.svg`
- `src/public/assets/cars/ferrari.svg`
- `src/public/assets/cars/mercedes.svg`
- `src/public/assets/cars/mclaren.svg`
