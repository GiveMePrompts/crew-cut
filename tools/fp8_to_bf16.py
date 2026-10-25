#!/usr/bin/env python3
"""Dequantize a ComfyUI 'scaled fp8' safetensors file to bf16, streaming (low RAM).

Apple Silicon (MPS) cannot cast float8 tensors, so fp8 checkpoints fail at sampling.
usage: fp8_to_bf16.py <in.safetensors> <out.safetensors>
"""
import json, struct, sys
import torch
from safetensors import safe_open

src, dst = sys.argv[1], sys.argv[2]
DT = {torch.bfloat16: 'BF16', torch.float16: 'F16', torch.float32: 'F32', torch.int64: 'I64', torch.int32: 'I32', torch.uint8: 'U8', torch.int8: 'I8', torch.bool: 'BOOL'}

with safe_open(src, 'pt') as f:
    keys = list(f.keys())
    drop = {k for k in keys if k.endswith(('.input_scale', '.weight_scale', '.scale_input', '.scale_weight'))}
    plan = []
    for k in keys:
        if k in drop:
            continue
        sl = f.get_slice(k)
        dtype, shape = sl.get_dtype(), sl.get_shape()
        out_dt = 'BF16' if dtype.startswith('F8') else dtype
        n = 1
        for s in shape: n *= s
        size = n * {'BF16': 2, 'F16': 2, 'F32': 4, 'I64': 8, 'I32': 4, 'U8': 1, 'I8': 1, 'BOOL': 1}[out_dt]
        plan.append((k, out_dt, shape, size, dtype.startswith('F8')))
    header, off = {}, 0
    for k, dt, shape, size, _ in plan:
        header[k] = {'dtype': dt, 'shape': shape, 'data_offsets': [off, off + size]}
        off += size
    meta = {k: v for k, v in (f.metadata() or {}).items() if k != '_quantization_metadata'}
    if meta:
        header['__metadata__'] = meta
    hb = json.dumps(header, separators=(',', ':')).encode()
    hb += b' ' * ((8 - len(hb) % 8) % 8)
    with open(dst, 'wb') as out:
        out.write(struct.pack('<Q', len(hb)))
        out.write(hb)
        for k, dt, shape, size, is_fp8 in plan:
            t = f.get_tensor(k)
            if is_fp8:
                base = k[:-len('.weight')] if k.endswith('.weight') else k
                scale = None
                for sk in (base + '.weight_scale', base + '.scale_weight'):
                    if sk in keys:
                        scale = f.get_tensor(sk).float()
                        break
                t = t.float()
                if scale is not None:
                    t = t * scale
                t = t.to(torch.bfloat16)
            b = t.contiguous().reshape(-1).view(torch.uint8).numpy().tobytes() if t.dtype in (torch.bfloat16, torch.float16) else t.contiguous().numpy().tobytes()
            assert len(b) == size, (k, len(b), size)
            out.write(b)
print('wrote', dst, off + len(hb) + 8, 'bytes;', sum(1 for p in plan if p[4]), 'fp8 tensors dequantized;', len(drop), 'scale tensors dropped')
