# Crew Cut

**A party game that makes a movie.** Everyone joins from their phone, turns their selfie into a character, and takes turns secretly directing scenes. Then the TV premieres a short film starring the whole crew, everyone votes on the awards, and you download the movie to post.

Built for Comfy's **#OpenSourceHiggsfield** challenge. Runs on ComfyUI through the official Comfy SDK, open-weights models only. Crew Cut by GiveMePrompts.

## How a game goes
1. **TV:** open Crew Cut on a laptop hooked to the TV. Pick a genre (Heist, Horror, Rom-com) and the director's clock.
2. **Phones:** scan the QR code. Type your name, take a selfie, and Crew Cut draws you as a character. Redraw twice, or play as one of the four Crew Cut originals.
3. **Shoot:** three scenes. Each one, a different player secretly picks the shot, casts it, and adds a twist. Scenes render while the next player directs.
4. **Premiere:** title card, the three scenes with twist reveals, the end card. Phones throw emoji and ink at the screen.
5. **Awards:** vote best director and best performance. Download the film (9:16 for stories, 16:9 widescreen) or share it straight from your phone.

## Quick start (preview mode, no GPU)
Needs Node 18+ and an ffmpeg build with the `drawtext` filter for the film export (`brew install ffmpeg-full`; the plain `ffmpeg` formula lacks it). Point `FFMPEG_PATH` at a specific binary if needed.
```bash
npm start
```
- TV: open http://localhost:3000
- Phones: same Wi-Fi, scan the QR code on the TV.
Preview mode stylizes selfies and composites the characters into placeholder scenes so the whole game is playable without a GPU.

## Real AI scenes
See [workflows/README.md](workflows/README.md). Short version: export your ComfyUI workflows in API format into `/workflows`, run `comfy-api-proxy`, then `npm install && npm run comfy`. Works against a local ComfyUI (Mac or PC), Comfy Cloud, or a Comfy API deployment with the same code.

## Settings
| Env | Default | What |
|---|---|---|
| `PORT` | 3000 | Server port |
| `GENERATOR` | `mock` | `mock` (preview) or `comfy` (real AI) |
| `COMFY_BASE_URL` | Comfy Cloud | e.g. `http://127.0.0.1:8189` for local ComfyUI via comfy-api-proxy |
| `COMFY_API_KEY` | – | Needed for Comfy Cloud or a deployment |
| `MOCK_DELAY_MS` | 5000 | Fake render time in preview mode |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary to use (needs `drawtext`) |
| `VOTE_SECONDS` | 40 | Voting time |

Add `?ink=0` to any URL to turn off the live ink background on slow devices.

## Tests
```bash
npm start &
npm run sim    # 4 fake phones play a full game: consent, presets, rerolls, turn order, secrecy, voting, export
```

## Privacy and safety
- Selfies are only used after the player confirms it's them. Anyone can play as a preset instead.
- Selfies, characters and movies stay on the machine running the server (`data/`), and rooms are deleted after 6 hours.
- Twists are capped at 80 characters.

## Credits
Fluid ink background adapted from the GiveMePrompts Lab. Fonts: Big Shoulders Stencil and Fredoka (SIL Open Font License). QR codes: qrcode-generator (MIT).

## License
MIT. Crew Cut by GiveMePrompts.
