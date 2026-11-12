# Fonts for resume export

Embedded in exported PDFs by `src/lib/agent/export.ts`. The DOCX export names a font that ships with Word instead. Liberation Serif and Liberation Sans are metric-compatible with Times New Roman and Arial, so those templates fit the same in both formats. Lato isn't metric-compatible with Calibri: Calibri is a little narrower, so a Modern DOCX can run slightly shorter than the PDF, never longer.

| Template | PDF font (embedded) | DOCX font | Source | License |
|---|---|---|---|---|
| Classic | Liberation Serif 2.1.5 | Times New Roman | github.com/liberationfonts/liberation-fonts, release 2.1.5 | SIL OFL 1.1, `LICENSE-Liberation.txt` |
| Modern | Lato | Calibri | github.com/google/fonts `ofl/lato` | SIL OFL 1.1, `LICENSE-Lato.txt` |
| Compact | Liberation Sans 2.1.5 | Arial | as Liberation Serif | SIL OFL 1.1, `LICENSE-Liberation.txt` |

Downloaded 2026-11-12. Bold-italic files were left out because no template uses them. Carlito was tried for Modern and dropped: pdf-lib's subsetting lost most of its glyphs, and its ligatures broke the PDF's text layer ("Pittsburgh" extracted as "Pisburgh").

Ligatures are turned off when embedding, so every letter in the PDF text layer is a letter, which matters for applicant tracking systems.
