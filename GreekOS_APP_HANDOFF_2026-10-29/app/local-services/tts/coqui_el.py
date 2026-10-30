"""Local Greek neural TTS: Coqui `tts_models/el/cv/vits` (BSD-3-Clause, CSS10 Greek speaker that
the release declares as "female" in speaker_ids.json).

Security: weights are loaded with torch.load(weights_only=True) — tensors/primitives only, so the
downloaded checkpoint cannot execute code. The model graph comes from the coqui-tts PyPI package.
"""
import os
from pathlib import Path

import numpy as np
import torch
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.models.vits import Vits
from TTS.tts.utils.text.tokenizer import TTSTokenizer

MODEL_DIR = Path(os.environ.get("COQUI_EL_DIR", Path.home() / "greekos-models/coqui-el/tts_models--el--cv--vits"))


class CoquiGreek:
    def __init__(self, model_dir: Path = MODEL_DIR):
        cfg = VitsConfig()
        cfg.load_json(str(model_dir / "config.json"))
        cfg.model_args.speakers_file = str(model_dir / "speaker_ids.json")
        cfg.model_args.language_ids_file = str(model_dir / "language_ids.json")
        cfg.language_ids_file = str(model_dir / "language_ids.json")
        cfg.model_args.num_languages = 1
        cfg.speakers_file = None
        self.tokenizer, cfg = TTSTokenizer.init_from_config(cfg)
        self.model = Vits.init_from_config(cfg)
        state = torch.load(model_dir / "model_file.pth.tar", map_location="cpu", weights_only=True)["model"]
        self.model.load_state_dict(state, strict=False)
        self.model.eval()
        self.sample_rate = cfg.audio.sample_rate
        torch.set_num_threads(max(1, (os.cpu_count() or 2)))

    HOP = 256
    # Carrier context for short inputs: the duration predictor (trained on audiobook sentences)
    # stretches 1–3-word inputs ~5×. The target is synthesised inside a neutral sentence and cut
    # out exactly by its predicted token durations.
    CARRIER_PRE = "Και τώρα ακούμε:"
    CARRIER_POST = "Αυτό ήταν όλο για σήμερα."
    SHORT_TOKENS = 141  # ≈ 70 phoneme symbols incl. blanks (≈ 6–8 words)
    MAX_FRAMES_PER_TOKEN = 5.5  # normal reading ≈ 2–4 frames per token (blanks included)

    def _infer(self, ids, length_scale, noise_scale, noise_w):
        x = torch.LongTensor([ids])
        self.model.length_scale = length_scale
        self.model.inference_noise_scale = noise_scale
        self.model.inference_noise_scale_dp = noise_w
        with torch.no_grad():
            out = self.model.inference(x, aux_input={"x_lengths": torch.LongTensor([len(ids)]), "speaker_ids": torch.LongTensor([0]), "language_ids": torch.LongTensor([0])})
        audio = out["model_outputs"].squeeze().cpu().numpy().astype(np.float32)
        frames = out["alignments"][0].sum(dim=-1).cpu().numpy()  # [T_enc, T_dec] → frames per input token
        return audio, frames

    def synth(self, text: str, length_scale: float = 1.0, noise_scale: float = 0.667, noise_w: float = 0.8) -> np.ndarray:
        ids = self.tokenizer.text_to_ids(text, language="el")
        if len(ids) >= self.SHORT_TOKENS:
            audio, frames = self._infer(ids, length_scale, noise_scale, noise_w)
            # Duration sanity check: a stretched utterance is re-synthesised inside the carrier.
            if frames.mean() / max(length_scale, 1e-3) <= self.MAX_FRAMES_PER_TOKEN:
                return audio
        # Word boundaries around the target: without a space token the model glued «…ακούμε:» and «Αυτό…»
        # to it, and the onset of the next carrier word bled into the slice (ASR heard «… σου αφ'»).
        blank, space = self.tokenizer.characters.char_to_id("<BLNK>"), self.tokenizer.characters.char_to_id(" ")
        pre = self.tokenizer.text_to_ids(self.CARRIER_PRE, language="el")[:-1] + [blank, space]
        post = [space] + self.tokenizer.text_to_ids(self.CARRIER_POST, language="el")
        audio, frames = self._infer(pre + ids + post, length_scale, noise_scale, noise_w)
        start = int(frames[: len(pre)].sum()) * self.HOP
        end = int(frames[: len(pre) + len(ids)].sum()) * self.HOP
        seg = audio[start:end].copy()
        fade = min(len(seg) // 4, int(self.sample_rate * 0.012))
        if fade > 0:
            ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            seg[:fade] *= ramp
            seg[-fade:] *= ramp[::-1]
        return seg
