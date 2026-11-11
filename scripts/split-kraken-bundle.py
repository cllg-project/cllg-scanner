#!/usr/bin/env python3
"""
Split a multi-model Kraken .safetensors bundle (e.g. eScriptorium's cllg-combined) into
one .safetensors per sub-model, so export_kraken_onnx.py (one model per file) can convert
each of them.

    python -I split-kraken-bundle.py bundle.safetensors out_dir

Writes out_dir/<task>-<ModelName>.safetensors for every model listed in `kraken_meta`
(task = segmentation | recognition | reading_order) and prints one line per file.
"""
import json
import sys
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import save_file


def main(src: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with safe_open(src, framework='pt') as f:
        meta = json.loads(f.metadata()['kraken_meta'])
        extra = {k: v for k, v in f.metadata().items() if k != 'kraken_meta'}
        for prefix, info in meta.items():
            tensors = {k: f.get_tensor(k) for k in f.keys() if k.startswith(prefix + '.')}
            name = f"{(info.get('_tasks') or ['unknown'])[0]}-{info['_model']}.safetensors"
            # `extra` holds tied-weight aliases (key -> source key) of the model they belong to.
            own_extra = {k: v for k, v in extra.items() if k.startswith(prefix + '.')}
            save_file(tensors, str(out / name),
                      metadata={'kraken_meta': json.dumps({prefix: info}), **own_extra})
            print(f'{name}: {len(tensors)} tensors')


if __name__ == '__main__':
    main(*sys.argv[1:3])
