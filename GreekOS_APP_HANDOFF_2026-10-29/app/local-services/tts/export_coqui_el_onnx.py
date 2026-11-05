"""Export the Coqui `tts_models/el/cv/vits` Greek voice (BSD-3-Clause, CSS10 Greek, speaker
declared "female" in the release's speaker_ids.json) to ONNX for pickle-free local inference.

Security: the checkpoint is loaded with torch.load(weights_only=True) — only tensors and primitive
values are accepted, so no code inside the downloaded file can execute.

Usage (Python 3.11 venv with coqui-tts installed):
  python export_coqui_el_onnx.py <model_dir> <out.onnx>
"""
import json
import sys
from pathlib import Path

import torch
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.models.vits import Vits

model_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
cfg = VitsConfig()
cfg.load_json(str(model_dir / "config.json"))
cfg.model_args.speakers_file = str(model_dir / "speaker_ids.json")
cfg.model_args.language_ids_file = str(model_dir / "language_ids.json")
cfg.speakers_file = None
cfg.language_ids_file = str(model_dir / "language_ids.json")
cfg.model_args.num_languages = 1
model = Vits.init_from_config(cfg)
state = torch.load(model_dir / "model_file.pth.tar", map_location="cpu", weights_only=True)["model"]
missing, unexpected = model.load_state_dict(state, strict=False)
print("missing", len(missing), "unexpected", len(unexpected))
# The legacy TorchScript exporter handles VITS control flow; newer torch defaults to dynamo.
_export = torch.onnx.export
torch.onnx.export = lambda *a, **k: _export(*a, **{**k, "dynamo": False})
model.eval()
model.export_onnx(output_path=str(out), verbose=False)
meta = {
    "source": "https://github.com/coqui-ai/TTS/releases/download/v0.8.0_models/tts_models--el--cv--vits.zip",
    "license": "BSD-3-Clause (Coqui .models.json: author @NeonGeckoCom)",
    "dataset": "CSS10 Greek (public-domain LibriVox reading)",
    "speaker_ids": json.loads((model_dir / "speaker_ids.json").read_text()),
    "sample_rate": cfg.audio.sample_rate,
    "characters": cfg.characters.to_dict() if hasattr(cfg.characters, "to_dict") else None,
    "phoneme_language": cfg.phoneme_language,
    "add_blank": cfg.add_blank,
    "use_phonemes": cfg.use_phonemes,
}
(out.parent / (out.stem + ".meta.json")).write_text(json.dumps(meta, ensure_ascii=False, indent=1, default=str))
print("exported", out, out.stat().st_size)
