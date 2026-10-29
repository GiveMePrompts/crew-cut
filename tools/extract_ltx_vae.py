#!/usr/bin/env python3
"""Pull the VAE out of an LTX-Video checkpoint into its own bf16 file (streaming, low RAM).

The GGUF LTX unet ships without a VAE, so ComfyUI needs one separately.
usage: extract_ltx_vae.py <ltxv-checkpoint.safetensors> <out-vae.safetensors>
e.g.   extract_ltx_vae.py ltxv-2b-0.9.8-distilled-fp8.safetensors models/vae/ltxv-0.9.8-vae-bf16.safetensors
"""
import json, struct, sys
import torch
from safetensors import safe_open

PREFIX = 'vae.'
SIZES = {'BF16': 2, 'F16': 2, 'F32': 4}

def main(src, dst):
    with safe_open(src, 'pt') as f:
        meta = f.metadata() or {}
        keys = [k for k in f.keys() if k.startswith(PREFIX) and not k.endswith(('_scale', '.scale_weight', '.scale_input'))]
        if not keys:
            sys.exit('no "vae." tensors found: is this an LTX-Video checkpoint?')
        plan, off = [], 0
        for k in keys:
            sl = f.get_slice(k)
            dt = sl.get_dtype()
            out = 'BF16' if dt.startswith('F8') or dt == 'F32' else dt
            if out not in SIZES:
                sys.exit(f'unexpected dtype {dt} for {k}')
            n = 1
            for s in sl.get_shape(): n *= s
            plan.append((k, k[len(PREFIX):], out, sl.get_shape(), off, n * SIZES[out]))
            off += n * SIZES[out]
        header = {new: {'dtype': dt, 'shape': shape, 'data_offsets': [o, o + size]} for _, new, dt, shape, o, size in plan}
        if 'config' in meta:  # ComfyUI reads the VAE config from here
            header['__metadata__'] = {'config': meta['config']}
        hb = json.dumps(header, separators=(',', ':')).encode()
        hb += b' ' * (-len(hb) % 8)
        torch_dt = {'BF16': torch.bfloat16, 'F16': torch.float16}
        with open(dst, 'wb') as o:
            o.write(struct.pack('<Q', len(hb))); o.write(hb)
            for k, _, dt, _, _, _ in plan:
                t = f.get_tensor(k).to(torch_dt[dt]).contiguous()
                o.write(t.reshape(-1).view(torch.uint8).numpy().tobytes())
    print(f'wrote {len(plan)} tensors, {off:,} bytes -> {dst}')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
