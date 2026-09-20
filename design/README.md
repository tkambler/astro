# Design mockups

Static mockups for the Notational Velocity / nvALT replacement.

Source of truth is the design canvas: <https://claude.ai/artifact/NHnqXMMeAFdZGZbTSMQWMD>
(design 01). These files are exports of it, captured 2026-09-20.

## Layout

```
design/
  tokens.css              the light + dark palette, named
  mockups/<design>/*.png  2× screenshots (desktop 2880×1800, mobile 780×1688)
  html/<design>/*.html    the same screens as standalone pages
```

Each `.html` is self-contained — open it in a browser at the matching size and
you get the artboard exactly as the PNG shows it. The only external request is
the Google Fonts stylesheet for JetBrains Mono (designs 02–05 load their own
faces). **There is no separate stylesheet**: every rule is either an inline
`style` attribute or the small `<style>` block in the head, because each file
was authored as an independent artboard. `tokens.css` is the palette pulled
out and named for implementation; it is not referenced by the HTML.

## Designs

`01-terminal` is the chosen direction and the only one carried forward. It has
ten screens — five light, five dark:

| screen | what it shows |
| --- | --- |
| `01/06 desktop-mdxeditor` | omnibar active over live results; MDXEditor in rich-text mode in the main pane |
| `02/07 mobile-search` | omnibar and ranked results, create row on the keyboard line |
| `03/08 mobile-editing` | note open with the compact MDXEditor toolbar |
| `04/09 desktop-settings` | Appearance: theme sub-section, accent, sidebar, typography |
| `05/10 mobile-settings` | the same settings as grouped rows |

Designs `02-paper`, `03-grid`, `04-desk`, `05-midnight` are the other four
directions from the first round, three screens each. Kept for reference.

## Notes on the Terminal screens

- Light and dark are a one-to-one token swap, not two hand-built skins — see
  `tokens.css`. The dark screens are the same markup with eleven values changed.
- The settings screens are drawn with **Show note previews** switched **off**,
  which is why their note list is one line per row; every other screen has it on.
- The desktop settings screens show Light selected in the light theme and Dark
  selected in the dark theme, so the pair reads as one screen in two states.
