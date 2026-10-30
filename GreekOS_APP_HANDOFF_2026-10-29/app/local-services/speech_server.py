#!/usr/bin/env python3
"""
GreekOS local speech service (development only, binds 127.0.0.1). No network, no keys, no cost.

TTS voices (each a real, separately recorded speaker — presentation is what the release declares):
  coqui-el-css10  Coqui `tts_models/el/cv/vits` (BSD-3-Clause, CSS10 Greek public-domain reading);
                  the release's speaker_ids.json declares the speaker "female". Neural VITS, 22.05 kHz.
  mbrola-gr2      MBROLA gr2 diphone database (Univ. of Athens; declared "Greek male"), driven by
                  espeak-ng. Non-commercial licence → DEV_LOCAL_ONLY. Diphone synthesis: low naturalness.
  mbrola-gr1      MBROLA gr1 (declared "Greek male"); older inventory with missing diphones.
ASR (sherpa-onnx Whisper, int8 ONNX — no pickle): tiny/base/small/turbo, whichever is installed.

  GET  /health                    → {ok, voices, asr: {available, loaded}}
  GET  /voices                    → catalog entries (declared presentation, licence, engine)
  POST /tts      JSON {voice, text, speed?: normal|slow|fast}  → audio/wav PCM16 mono 24 kHz
  POST /transcribe?model=small&lang=el   body: WAV → {text, confidence, no_speech_prob, ...}

Env: GREEKOS_MODELS (default ~/greekos-models), LOCAL_SPEECH_PORT (3312), LOCAL_ASR_TOKEN (optional
shared secret header X-Local-ASR-Token), LOCAL_ASR_PRELOAD (comma list, default "small").
Security: Coqui weights are loaded with torch.load(weights_only=True) (tensors only).
"""
import io
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

MODELS = Path(os.environ.get("GREEKOS_MODELS", Path.home() / "greekos-models"))
PORT = int(os.environ.get("LOCAL_SPEECH_PORT", os.environ.get("LOCAL_ASR_PORT", "3312")))
TOKEN = os.environ.get("LOCAL_ASR_TOKEN", "")
OUT_RATE = 24000
MAX_BYTES = 30_000_000
MAX_TTS_CHARS = 1200

# Speed profiles: Coqui length_scale (duration multiplier) / espeak-ng words per minute.
COQUI_SPEED = {"normal": 1.0, "slow": 1.18, "fast": 0.9}
MBROLA_WPM = {"normal": 140, "slow": 120, "fast": 155}

VOICES = {
    "coqui-el-css10": {
        "id": "coqui-el-css10", "name": "Ελένη · CSS10 (Coqui VITS)", "engine": "coqui-vits",
        "presentation": "female", "presentation_source": "release speaker_ids.json {\"female\": 0}",
        "quality_tier": "neural-vits-22k", "license": "BSD-3-Clause (model), CSS10 Greek dataset: public domain (LibriVox)",
        "distribution_allowed_by_license": True, "streaming_capable": True,
        "source": "https://github.com/coqui-ai/TTS/releases/download/v0.8.0_models/tts_models--el--cv--vits.zip",
    },
    "mbrola-gr2": {
        "id": "mbrola-gr2", "name": "Γιώργος · MBROLA gr2", "engine": "espeak-ng+mbrola",
        "presentation": "male", "presentation_source": "MBROLA gr2 voice description \"Greek male\"",
        "quality_tier": "diphone-low-naturalness", "license": "MBROLA gr2: free for non-commercial use; may not be sold or incorporated into a sold product without the owners' permission",
        "distribution_allowed_by_license": False, "streaming_capable": True,
        "source": "Ubuntu package mbrola-gr2 (github.com/mbrola/mbrola-voices)",
    },
    "mbrola-gr1": {
        "id": "mbrola-gr1", "name": "Νίκος · MBROLA gr1", "engine": "espeak-ng+mbrola",
        "presentation": "male", "presentation_source": "MBROLA gr1 voice description \"Greek male\"",
        "quality_tier": "diphone-low-naturalness", "license": "MBROLA gr1: free for non-commercial use (MBROLA licence)",
        "distribution_allowed_by_license": False, "streaming_capable": True,
        "source": "Ubuntu package mbrola-gr1 (github.com/mbrola/mbrola-voices)",
    },
}

_coqui = None
_coqui_lock = threading.Lock()
_asr = {}
_asr_locks = {}
_asr_load_lock = threading.Lock()


def coqui_dir():
    return MODELS / "coqui-el" / "tts_models--el--cv--vits"


def voice_available(vid):
    if vid == "coqui-el-css10":
        try:
            import torch  # noqa: F401
            import TTS  # noqa: F401
        except Exception:
            return False
        return (coqui_dir() / "model_file.pth.tar").exists()
    if vid.startswith("mbrola-"):
        db = vid.split("-", 1)[1]
        return bool(shutil.which("espeak-ng")) and any(Path(p, db, db).exists() for p in ("/usr/share/mbrola", "/opt/homebrew/share/mbrola", "/usr/local/share/mbrola"))
    return False


def get_coqui():
    global _coqui
    with _coqui_lock:
        if _coqui is None:
            import sys
            sys.path.insert(0, str(Path(__file__).parent / "tts"))
            from coqui_el import CoquiGreek
            _coqui = CoquiGreek(coqui_dir())
        return _coqui


def to_out_rate(audio, rate):
    if rate == OUT_RATE:
        return audio
    g = math.gcd(rate, OUT_RATE)
    return resample_poly(audio, OUT_RATE // g, rate // g).astype(np.float32)


def trim_silence(audio, rate, threshold_db=-48.0, keep_ms=60):
    """Trims leading/trailing digital silence only (keeps natural edges)."""
    if audio.size == 0:
        return audio
    win = max(1, int(rate * 0.01))
    n = audio.size // win
    if n == 0:
        return audio
    frames = audio[: n * win].reshape(n, win)
    db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    voiced = np.where(db > threshold_db)[0]
    if voiced.size == 0:
        return audio
    keep = int(rate * keep_ms / 1000)
    start = max(0, voiced[0] * win - keep)
    end = min(audio.size, (voiced[-1] + 1) * win + keep)
    return audio[start:end]


def wav_bytes(audio, rate):
    audio = np.clip(audio, -1.0, 1.0)
    buf = io.BytesIO()
    sf.write(buf, audio, rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


def synth(vid, text, speed):
    # Dashes are not in the phoneme inventory: read them as a short pause.
    text = " ".join(text.replace("—", ",").replace("–", ",").replace(" ,", ",").split())
    if not text:
        raise ValueError("empty text")
    if vid == "coqui-el-css10":
        g = get_coqui()
        # VITS needs sentence-final punctuation to stop cleanly on very short inputs.
        t = text if text[-1] in ".;!?…·" else text + "."
        # Isolated words are read slightly slower so every syllable is audible.
        scale = COQUI_SPEED.get(speed, 1.0) * (1.12 if len(text.split()) <= 2 else 1.0)
        with _coqui_lock:
            audio = g.synth(t, length_scale=scale)
        audio = trim_silence(audio, g.sample_rate)
        return to_out_rate(audio, g.sample_rate)
    if vid.startswith("mbrola-"):
        db = vid.split("-", 1)[1]
        with tempfile.TemporaryDirectory() as d:
            out = Path(d, "o.wav")
            subprocess.run(["espeak-ng", "-v", f"mb-{db}", "-s", str(MBROLA_WPM.get(speed, 150)), "-w", str(out), text], check=True, capture_output=True, timeout=60)
            audio, rate = sf.read(out, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return to_out_rate(trim_silence(audio, rate), rate)
    raise ValueError("unknown voice")


# ---------------- ASR ----------------

def asr_dir(name):
    return MODELS / f"sherpa-onnx-whisper-{name}"


def asr_available():
    return [n for n in ("tiny", "base", "small", "medium", "turbo") if (asr_dir(n) / f"{n}-encoder.int8.onnx").exists()]


def get_asr(name):
    with _asr_load_lock:
        if name not in _asr:
            import sherpa_onnx
            d = asr_dir(name)
            _asr[name] = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=str(d / f"{name}-encoder.int8.onnx"), decoder=str(d / f"{name}-decoder.int8.onnx"), tokens=str(d / f"{name}-tokens.txt"),
                language="el", task="transcribe", num_threads=max(1, os.cpu_count() or 2), tail_paddings=-1)
            _asr_locks[name] = threading.Lock()
        return _asr[name], _asr_locks[name]


# sherpa-onnx caps Whisper output at ~6 tokens per second of INPUT audio, while fluent Greek needs
# ~10 tokens/s (about 2 characters per token): every chunk silently lost its tail. Chunks therefore stay
# <= 15 s, are cut in the longest pause near the boundary, and each is padded with trailing silence to
# ~29 s so the cap (~174 tokens) exceeds what 15 s of speech can need. The encoder sees a 30 s window
# either way, so the padding costs no extra encoder time.
ASR_CHUNK_S = float(os.environ.get("LOCAL_ASR_CHUNK_S", "15"))
ASR_WINDOW_S = 29.0
ASR_HEAD_S = 0.3


def split_long(audio, rate, max_s=ASR_CHUNK_S, search_s=8.0):
    """Cuts long audio into <= max_s chunks at the longest low-energy run near each boundary."""
    if audio.size <= int(rate * max_s):
        return [audio]
    win = int(rate * 0.02)
    n = audio.size // win
    energy = np.sqrt((audio[: n * win].reshape(n, win) ** 2).mean(axis=1))
    floor = max(float(np.percentile(energy, 10)) * 2.5, 1e-4)
    cuts, start = [], 0
    while (audio.size - start) > int(rate * max_s):
        hi = min(n - 1, (start + int(rate * max_s)) // win)
        lo = max(start // win + 1, hi - int(search_s / 0.02))
        best, best_len, run = None, 0, 0
        for i in range(lo, hi):
            run = run + 1 if energy[i] <= floor else 0
            if run > best_len:
                best_len, best = run, i - run // 2
        if best is None or best_len < 3:  # no real pause (< 60 ms): fall back to the quietest frame
            best = lo + int(np.argmin(energy[lo:hi]))
        cut = best * win
        cuts.append((start, cut))
        start = cut
    cuts.append((start, audio.size))
    return [audio[a:b] for a, b in cuts]


def transcribe(data, name):
    audio, rate = sf.read(io.BytesIO(data), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    duration = audio.size / rate
    rms = float(np.sqrt((audio ** 2).mean())) if audio.size else 0.0
    rec, lock = get_asr(name)
    texts, lps, segs = [], [], []
    t0 = time.time()
    offset = 0.0
    for part in split_long(audio, rate):
        tail = max(0.8, ASR_WINDOW_S - ASR_HEAD_S - part.size / rate)
        padded = np.concatenate([np.zeros(int(rate * ASR_HEAD_S), dtype=np.float32), part, np.zeros(int(rate * tail), dtype=np.float32)])
        with lock:
            s = rec.create_stream()
            s.accept_waveform(rate, padded)
            rec.decode_stream(s)
        r = s.result
        part_lps = list(getattr(r, "ys_log_probs", []) or [])
        lps += part_lps
        texts.append(r.text.strip())
        segs.append({"start": round(offset, 3), "end": round(offset + part.size / rate, 3), "text": r.text.strip(), "avg_logprob": (sum(part_lps) / len(part_lps)) if part_lps else 0.0, "no_speech_prob": 0.0})
        offset += part.size / rate
    confidence = float(math.exp(sum(lps) / len(lps))) if lps else None
    # No VAD-based probability is available from this decoder: report a signal-energy heuristic only.
    no_speech = 1.0 if rms < 1e-4 else 0.0
    return {
        "text": " ".join(t for t in texts if t), "confidence": confidence, "no_speech_prob": no_speech, "duration_s": round(duration, 3),
        "elapsed_ms": int((time.time() - t0) * 1000), "model": f"whisper-{name}-int8", "engine": "sherpa-onnx", "chunks": len(segs), "segments": segs,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "greekos-local-speech/1.0"

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        return not TOKEN or self.headers.get("x-local-asr-token") == TOKEN

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            voices = [v for v in VOICES if voice_available(v)]
            return self._json(200, {"ok": True, "voices": voices, "available": asr_available(), "loaded": sorted(_asr.keys()), "asr": {"available": asr_available(), "loaded": sorted(_asr.keys())}})
        if u.path == "/voices":
            return self._json(200, [{**v, "available": voice_available(v["id"]), "sample_rate": OUT_RATE, "speed_profile": {"normal": 1.0, "slow": 0.85, "fast": 1.1}} for v in VOICES.values()])
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth():
            return self._json(401, {"error": "unauthorized"})
        u = urlparse(self.path)
        n = int(self.headers.get("content-length", "0"))
        if n <= 0 or n > MAX_BYTES:
            return self._json(413, {"error": "bad length"})
        data = self.rfile.read(n)
        try:
            if u.path == "/tts":
                req = json.loads(data)
                vid, text, speed = req.get("voice"), str(req.get("text", "")), req.get("speed", "normal")
                if vid not in VOICES or not voice_available(vid):
                    return self._json(404, {"error": "voice unavailable"})
                if len(text) > MAX_TTS_CHARS:
                    return self._json(413, {"error": "text too long"})
                t0 = time.time()
                audio = synth(vid, text, speed)
                body = wav_bytes(audio, OUT_RATE)
                self.send_response(200)
                self.send_header("content-type", "audio/wav")
                self.send_header("content-length", str(len(body)))
                self.send_header("x-synthesis-ms", str(int((time.time() - t0) * 1000)))
                self.end_headers()
                self.wfile.write(body)
                return
            if u.path == "/transcribe":
                q = parse_qs(u.query)
                name = q.get("model", ["small"])[0]
                if name == "medium" and "medium" not in asr_available():
                    name = "turbo" if "turbo" in asr_available() else "small"
                if name not in asr_available():
                    return self._json(404, {"error": f"model {name} not installed"})
                return self._json(200, transcribe(data, name))
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": str(e)[:300]})
        self._json(404, {"error": "not found"})


def main():
    for name in [x for x in os.environ.get("LOCAL_ASR_PRELOAD", "small").split(",") if x]:
        if name in asr_available():
            get_asr(name)
    if voice_available("coqui-el-css10") and os.environ.get("LOCAL_TTS_PRELOAD", "1") == "1":
        get_coqui()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"greekos-local-speech on 127.0.0.1:{PORT} voices={[v for v in VOICES if voice_available(v)]} asr={asr_available()}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
