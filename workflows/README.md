# Workflows: turning on real AI

Crew Cut runs three ComfyUI workflows through the official Comfy SDK. Put each one in this folder as an **API-format** export. Any stage you haven't added yet falls back to preview mode, so you can switch them on one at a time.

| File | In | Out | Suggested model (open weights) |
|---|---|---|---|
| `character.json` | 1 image (the selfie) + prompt | full-body character on flat cyan | Qwen-Image Edit, or FLUX Kontext dev |
| `keyframe.json` *(optional)* | 1–3 images (cast characters) + prompt | 16:9 scene still | Qwen-Image Edit (multi-image) |
| `scene.json` | 1 image (keyframe) + prompt | short video | LTX-Video image-to-video, or Wan i2v |

Without `keyframe.json`, the scene video starts from the first cast member's character art.

## Make each file
1. In ComfyUI, open the matching template (Templates menu) or your own graph. Make sure it runs by hand first.
2. The graph needs: a **Load Image** node for each input image, one positive prompt node, and a **Save Image** or **Save Video** node.
3. Export it: **Workflow → Export (API)**. Save as `workflows/character.json` (etc.). A normal "Save" file won't work.
4. Check what Crew Cut detected: `npm run inspect workflows/character.json`
5. If it guessed the wrong node, pin it in `workflows/character.bindings.json`:
```json
{ "images": [{ "node": "10", "field": "image" }], "prompt": { "node": "6", "field": "text" }, "seeds": [{ "node": "3", "field": "seed" }], "output": { "node": "9" } }
```

## Run it on your Mac (free, local)
```bash
pip install comfy-api-proxy
comfy-api-proxy --comfyui http://127.0.0.1:<ComfyUI port>   # Comfy Desktop often uses 8000, the portable/manual install 8188
npm install            # Node 22+ (installs @comfyorg/sdk)
npm run comfy          # GENERATOR=comfy, COMFY_BASE_URL=http://127.0.0.1:8189
```

## Or run it on Comfy Cloud
```bash
GENERATOR=comfy COMFY_API_KEY=comfyui-... node server.js
```
API access needs a paid Comfy Cloud plan. The models must be ones Comfy Cloud has installed.

## Mac speed tips
Apple Silicon runs image models fine but video is slow. For a party-speed game: render video at 512px wide, 2–3 seconds, with the fewest steps your model tolerates (distilled LTX variants help). The render queue runs one job at a time and the game keeps playing while scenes render.
