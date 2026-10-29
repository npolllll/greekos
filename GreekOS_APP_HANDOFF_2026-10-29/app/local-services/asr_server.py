#!/usr/bin/env python3
"""
GreekOS local ASR service (development only, binds 127.0.0.1).

Real Modern Greek recognition with locally cached Whisper models — no network, no paid service:
  - "small"  : openai-whisper small  (faster; used for live speaking partial/final transcripts)
  - "medium" : faster-whisper medium int8 (more accurate; used for audio QA round-trip)

  POST /transcribe?model=small|medium&lang=el   body: audio file bytes (WAV)
  GET  /health

Run:  PYENV_VERSION=3.9.6 HF_HUB_OFFLINE=1 python local-services/asr_server.py
Env:  LOCAL_ASR_PORT (3312), LOCAL_ASR_TOKEN (optional shared secret header X-Local-ASR-Token),
      LOCAL_ASR_PRELOAD (comma list, default "small").
The confidence returned is exp(mean segment avg_logprob): a provider-style signal, NOT a
probability that the learner's pronunciation or grammar is correct.
"""
import json
import math
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("HF_HUB_OFFLINE", "1")
PORT = int(os.environ.get("LOCAL_ASR_PORT", "3312"))
TOKEN = os.environ.get("LOCAL_ASR_TOKEN", "")
MAX_BYTES = 20_000_000

_models = {}
_locks = {"small": threading.Lock(), "medium": threading.Lock()}
_load_lock = threading.Lock()


def available():
    out = []
    try:
        import whisper  # noqa: F401
        if os.path.exists(os.path.expanduser("~/.cache/whisper/small.pt")):
            out.append("small")
    except Exception:
        pass
    try:
        import faster_whisper  # noqa: F401
        hub = os.path.expanduser("~/.cache/huggingface/hub/models--Systran--faster-whisper-medium")
        if os.path.isdir(hub):
            out.append("medium")
    except Exception:
        pass
    return out


def get_model(name):
    with _load_lock:
        if name in _models:
            return _models[name]
        if name == "small":
            import whisper
            _models[name] = ("openai-whisper", whisper.load_model("small"))
        elif name == "medium":
            from faster_whisper import WhisperModel
            _models[name] = ("faster-whisper", WhisperModel("medium", device="cpu", compute_type="int8"))
        else:
            raise ValueError("unknown model")
        return _models[name]


def transcribe(path, name, lang, max_tokens=None):
    # max_tokens caps decoding so truncated (partial) audio cannot loop into a long repetition.
    engine, model = get_model(name)
    t0 = time.time()
    with _locks[name]:
        if engine == "openai-whisper":
            extra = {"sample_len": max_tokens} if max_tokens else {}
            r = model.transcribe(path, language=lang, fp16=False, temperature=0.0, condition_on_previous_text=False, **extra)
            segs = [{"start": s["start"], "end": s["end"], "text": s["text"].strip(), "avg_logprob": s["avg_logprob"], "no_speech_prob": s["no_speech_prob"]} for s in r["segments"]]
            duration = segs[-1]["end"] if segs else 0.0
        else:
            extra = {"max_new_tokens": max_tokens} if max_tokens else {}
            it, info = model.transcribe(path, language=lang, beam_size=1, vad_filter=False, condition_on_previous_text=False, **extra)
            segs = [{"start": s.start, "end": s.end, "text": s.text.strip(), "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob} for s in it]
            duration = info.duration
    elapsed = int((time.time() - t0) * 1000)
    text = " ".join(s["text"] for s in segs).strip()
    if segs:
        weights = [max(0.01, s["end"] - s["start"]) for s in segs]
        mean_lp = sum(s["avg_logprob"] * w for s, w in zip(segs, weights)) / sum(weights)
        confidence = math.exp(mean_lp)
        no_speech = max(s["no_speech_prob"] for s in segs)
    else:
        confidence, no_speech = None, 1.0
    return {"text": text, "segments": segs, "confidence": confidence, "no_speech_prob": no_speech,
            "duration_s": duration, "elapsed_ms": elapsed, "model": name, "engine": engine, "language": lang}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

    def _authorized(self):
        return not TOKEN or self.headers.get("X-Local-ASR-Token") == TOKEN

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._send(200, {"ok": True, "available": available(), "loaded": sorted(_models.keys())})
        self._send(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/transcribe":
            return self._send(404, {"error": "NOT_FOUND"})
        if not self._authorized():
            return self._send(401, {"error": "UNAUTHORIZED"})
        q = parse_qs(u.query)
        name = (q.get("model") or ["small"])[0]
        lang = (q.get("lang") or ["el"])[0]
        mt = (q.get("max_tokens") or [None])[0]
        max_tokens = max(8, min(440, int(mt))) if mt and mt.isdigit() else None
        if name not in ("small", "medium") or name not in available():
            return self._send(400, {"error": "MODEL_UNAVAILABLE", "available": available()})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 44 or length > MAX_BYTES:
            return self._send(413 if length > MAX_BYTES else 400, {"error": "BAD_AUDIO"})
        data = self.rfile.read(length)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(data)
            path = f.name
        try:
            self._send(200, transcribe(path, name, lang, max_tokens))
        except Exception as e:  # report, never invent a transcript
            self._send(500, {"error": "TRANSCRIBE_FAILED", "detail": str(e)[:200]})
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


if __name__ == "__main__":
    for m in [x.strip() for x in os.environ.get("LOCAL_ASR_PRELOAD", "small").split(",") if x.strip()]:
        if m in available():
            get_model(m)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(json.dumps({"listening": f"http://127.0.0.1:{PORT}", "available": available(), "loaded": sorted(_models.keys())}), flush=True)
    srv.serve_forever()
