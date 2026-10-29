# Workflows: turning on real AI

Crew Cut runs three ComfyUI workflows through the official Comfy SDK. Each one is an **API-format** export in this folder. Any stage that's missing falls back to preview mode, so you can switch them on one at a time.

| File | In | Out | Model in this repo |
|---|---|---|---|
| `character.json` | the selfie + prompt | full-body character on flat cyan (keyed out by Crew Cut) | FLUX.2 [klein] 4B image edit, GGUF Q4_K_M |
| `keyframe.json` | up to 2 cast characters + prompt | 1024×576 scene still | FLUX.2 [klein] 4B with reference latents, GGUF Q4_K_M |
| `scene.json` | the keyframe + motion prompt | 704×384, 65 frames (about 2.7 s) | LTX-Video 2B 0.9.6 distilled, GGUF Q5_K_M |

Without `keyframe.json`, the scene video starts from the first cast member's character art.

## Models to download
Put each file in the ComfyUI `models/` folder shown, and install the [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) custom node.

| Folder | File | From |
|---|---|---|
| `unet/` | `flux-2-klein-4b-Q4_K_M.gguf` (2.4 GB) | [unsloth/FLUX.2-klein-4B-GGUF](https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF) |
| `text_encoders/` | `qwen_3_4b_fp8_mixed.safetensors` | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo/tree/main/split_files/text_encoders) |
| `vae/` | `flux2-vae.safetensors` | [Comfy-Org/flux2-dev](https://huggingface.co/Comfy-Org/flux2-dev/tree/main/split_files/vae) |
| `unet/` | `ltxv-2b-0.9.6-distilled-04-25-Q5_K_M.gguf` (1.4 GB) | [city96/LTX-Video-0.9.6-distilled-gguf](https://huggingface.co/city96/LTX-Video-0.9.6-distilled-gguf) |
| `text_encoders/` | `t5-v1_1-xxl-encoder-Q4_K_M.gguf` (2.7 GB) | [city96/t5-v1_1-xxl-encoder-gguf](https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf) |
| `vae/` | `ltxv-0.9.8-vae-bf16.safetensors` | extract it, see below |

The LTX GGUF has no VAE inside. Download any LTX-Video 2B checkpoint (for example `ltxv-2b-0.9.8-distilled-fp8.safetensors` from [Lightricks/LTX-Video](https://huggingface.co/Lightricks/LTX-Video)), pull the VAE out, then delete the checkpoint:
```bash
python tools/extract_ltx_vae.py ltxv-2b-0.9.8-distilled-fp8.safetensors <ComfyUI>/models/vae/ltxv-0.9.8-vae-bf16.safetensors
```

## Run it on your Mac (free, local)
```bash
# ComfyUI: --bf16-unet matters for LTX on Apple Silicon (fp16 gives garbage frames)
python main.py --port 8188 --bf16-unet
pip install comfy-api-proxy
comfy-api-proxy run --comfyui http://127.0.0.1:8188    # Comfy Desktop often uses port 8000
npm install            # Node 22+ (installs @comfyorg/sdk)
npm run comfy          # GENERATOR=comfy, COMFY_BASE_URL=http://127.0.0.1:8189
```
Why GGUF: Apple's MPS backend can't run float8 tensors, so the fp8 checkpoints the ComfyUI templates ship with fail on a Mac. If you only have an fp8 file, `tools/fp8_to_bf16.py` converts it.

Measured on an M2 Max (32 GB): character about 2 minutes, keyframe about 2 minutes, scene about 2 minutes. The render queue runs one job at a time and the game keeps playing while scenes render.

To run one workflow by hand (handy when changing a graph):
```bash
python tools/comfy_run.py workflows/character.json out/ --upload 76=selfie.jpg --set "75:73.noise_seed=7"
```

## Or run it on Comfy Cloud
```bash
GENERATOR=comfy COMFY_API_KEY=comfyui-... node server.js
```
API access needs a paid Comfy Cloud plan, and the models must be ones Comfy Cloud has installed.

## Swap in your own workflows
1. In ComfyUI, open a template (Templates menu) or your own graph. Make sure it runs by hand first.
2. The graph needs a **Load Image** node for each input image, one positive prompt node, and a **Save Image** or **Save Video** node.
3. Export it with **Workflow → Export (API)** and save it as `workflows/character.json` (etc.). A normal "Save" file won't work.
4. Check what Crew Cut detected: `npm run inspect workflows/character.json`
5. If it guessed the wrong node, pin it in `workflows/character.bindings.json`:
```json
{ "images": [{ "node": "10", "field": "image" }], "prompt": { "node": "6", "field": "text" }, "seeds": [{ "node": "3", "field": "seed" }], "output": { "node": "9" } }
```
