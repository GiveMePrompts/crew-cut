# STATE — v0.2 (2026-10-24)

## Works (tested)
- Full game in preview mode: join, selfie character (with consent) or preset, 2 redraws, accept, host settings (genre, director clock), 3 secretly directed scenes, render queue, premiere, phone reactions, voting, awards, film export with burned-in title card, lower thirds, twists and end card, in 16:9 and 9:16.
- `npm run sim`: 21 checks pass (consent, room cap, preset conflicts, reroll, start gating, turn order, twist secrecy, vote validation, export, byte ranges, play again).
- Browser run, 1 TV + 4 phones: every screen, zero JS errors.
- Fluid ink background renders (tested in software WebGL).
- Comfy generator reaches the real SDK (`@comfyorg/sdk` 0.5.0) and submits; binding auto-detect tested on a sample workflow.

## Not verified yet
- Real ComfyUI run (needs your workflows + Mac).
- Video playback in the premiere (test browser has no H.264; Chrome/Safari do).
- Real phones: camera capture, iOS Safari, share sheet.
- Ink performance on older phones (`?ink=0` turns it off).
