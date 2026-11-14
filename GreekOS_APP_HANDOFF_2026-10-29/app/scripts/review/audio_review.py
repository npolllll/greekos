#!/usr/bin/env python3
"""GreekOS review — objective check of every released-candidate course audio file and of candidate voices.

What it can and cannot do (stated in every report): there is no human ear here. The checks are
measurable proxies for quality — intelligibility by two independent recognisers (Azure, the provider's
own, and Whisper, a different model), level/clipping/silence, pauses, speaking rate, pitch range
(monotony) and the pitch level of each speaker (to catch a wrong-gender or inconsistent voice). Stress
placement and naturalness are judged only indirectly (recognisers spelling a word with another stress).

  python3 scripts/review/audio_review.py assets   # 142 course files → reports/review/audio/
  python3 scripts/review/audio_review.py voices   # candidate Azure voices on a fixed Greek test set
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION.
"""
import io, json, math, os, re, subprocess, sys, time, unicodedata, urllib.request, urllib.error
import numpy as np
import parselmouth

OUT = 'reports/review/audio'
os.makedirs(OUT, exist_ok=True)
KEY = os.environ.get('AZURE_SPEECH_KEY', '')
REGION = os.environ.get('AZURE_SPEECH_REGION', 'northeurope').strip()
SUPA = os.environ.get('SUPABASE_URL', '').rstrip('/')
SERVICE = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

_whisper = None
def whisper():
    global _whisper
    if _whisper is None:
        try:
            from faster_whisper import WhisperModel
            _whisper = WhisperModel('small', device='cpu', compute_type='int8')
        except Exception as e:  # noqa: BLE001
            print(f'whisper unavailable: {e}', file=sys.stderr)
            _whisper = False
    return _whisper or None

def http(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def psql_json(sql):
    out = subprocess.run(['psql', os.environ['DATABASE_URL'], '-X', '-qAt', '-c', sql], check=True, capture_output=True, text=True).stdout
    return json.loads(out or 'null')

# ---------------- text helpers ----------------
GREEK_VOWELS = 'αεηιουωάέήίόύώϊϋΐΰ'
def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
def words(s):
    return [w for w in re.findall(r'[\wͰ-Ͽἀ-῿]+', unicodedata.normalize('NFC', s.lower())) if w]
def syllables(s):
    t = strip_accents(s.lower())
    t = re.sub(r'(αι|ει|οι|υι|ου|αυ|ευ|ηυ)', 'a', t)  # digraphs count once
    return sum(1 for c in t if c in 'αεηιουω')
def edit(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(b)]
def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    return round(edit(r, h) / max(1, len(r)), 3)
def wer_bare(ref, hyp):
    r, h = [strip_accents(w) for w in words(ref)], [strip_accents(w) for w in words(hyp)]
    return round(edit(r, h) / max(1, len(r)), 3)
def stress_mismatches(ref, hyp):
    """Polysyllabic reference words the recogniser wrote with the same letters but another stress."""
    hyp_by_bare = {}
    for w in words(hyp): hyp_by_bare.setdefault(strip_accents(w), set()).add(w)
    out = []
    for w in words(ref):
        alts = hyp_by_bare.get(strip_accents(w), set())
        if alts and w not in alts and syllables(w) > 1: out.append(f'{w}→{"/".join(sorted(alts))}')
    return out

# ---------------- acoustics ----------------
def acoustics(wav_bytes, cues=None):
    tmp = '/tmp/greekos-review.wav'
    with open(tmp, 'wb') as f: f.write(wav_bytes)
    snd = parselmouth.Sound(tmp)
    x = snd.values[0]
    sr = snd.sampling_frequency
    dur = snd.duration
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    clip = float(np.mean(np.abs(x) >= 0.999)) if x.size else 0.0
    inten = snd.to_intensity(time_step=0.01)
    iv = inten.values[0]
    thr = float(np.max(iv)) - 35.0 if iv.size else 0.0
    speech = iv > thr
    times = inten.xs()
    lead = float(times[np.argmax(speech)]) if speech.any() else dur
    trail = float(dur - times[len(speech) - 1 - np.argmax(speech[::-1])]) if speech.any() else dur
    # internal pauses
    pauses, run = [], 0
    first, last = (np.argmax(speech), len(speech) - 1 - np.argmax(speech[::-1])) if speech.any() else (0, 0)
    for v in speech[first:last + 1]:
        if not v: run += 1
        else:
            if run: pauses.append(run * 0.01)
            run = 0
    long_pauses = [p for p in pauses if p >= 0.25]
    voiced_time = max(0.01, (last - first) * 0.01 - sum(long_pauses))
    rms = float(np.sqrt(np.mean(np.square(x[np.abs(x) > 10 ** (-40 / 20)])))) if x.size else 0.0
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=70, pitch_ceiling=450)
    f0 = pitch.selected_array['frequency']
    tf = pitch.xs()
    def f0stats(a):
        a = a[a > 0]
        if a.size < 10: return None
        st = 12 * np.log2(a / np.median(a))
        return {'median_hz': round(float(np.median(a)), 1), 'range_st': round(float(np.percentile(st, 95) - np.percentile(st, 5)), 1)}
    seg = []
    for c in cues or []:
        s, e = (c.get('start_ms') or 0) / 1000, (c.get('end_ms') or 0) / 1000
        m = (tf >= s) & (tf <= e)
        st = f0stats(f0[m]) if m.any() else None
        seg.append({'speaker': c.get('speaker') or c.get('speaker_role') or c.get('role'), 'voice': c.get('voice') or c.get('voice_id'), 'f0': st})
    return {
        'duration_s': round(dur, 2), 'sample_rate': int(sr), 'peak_dbfs': round(20 * math.log10(peak), 1) if peak > 0 else None,
        'clipping_ratio': round(clip, 5), 'rms_dbfs': round(20 * math.log10(rms), 1) if rms > 0 else None,
        'lead_silence_s': round(lead, 2), 'trail_silence_s': round(trail, 2),
        'pauses_over_250ms': len(long_pauses), 'longest_pause_s': round(max(long_pauses), 2) if long_pauses else 0.0,
        'voiced_time_s': round(voiced_time, 2), 'f0': f0stats(f0), 'segments': seg,
    }

def azure_asr(wav_bytes):
    url = f'https://{REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=el-GR&format=detailed'
    try:
        j = json.loads(http(url, wav_bytes, {'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', 'Accept': 'application/json'}, 60))
    except urllib.error.HTTPError as e:
        return {'error': f'HTTP {e.code}'}
    best = (j.get('NBest') or [{}])[0]
    return {'text': best.get('Lexical') or best.get('Display') or '', 'confidence': best.get('Confidence')}

def resample16k(wav_bytes):
    tmp = '/tmp/greekos-review.wav'
    with open(tmp, 'wb') as f: f.write(wav_bytes)
    snd = parselmouth.Sound(tmp).resample(16000)
    snd.save('/tmp/greekos-16k.wav', 'WAV')
    return open('/tmp/greekos-16k.wav', 'rb').read()

def whisper_asr(wav_bytes, detect=False):
    """Independent recogniser. Audio goes in as a 16 kHz float array (no container decoding)."""
    m = whisper()
    if not m: return None
    with open('/tmp/greekos-w.wav', 'wb') as f: f.write(wav_bytes)
    snd = parselmouth.Sound('/tmp/greekos-w.wav').resample(16000)
    audio = snd.values[0].astype(np.float32)
    segs, info = m.transcribe(audio, language=None if detect else 'el', beam_size=1, vad_filter=False)
    text = ' '.join(s.text.strip() for s in segs)
    return {'text': text, 'language': info.language, 'language_probability': round(float(info.language_probability), 3)}

# ---------------- 1. course audio ----------------
def assets():
    rows = psql_json("""select json_agg(t order by t.audio_id) from (
      select a.id, a.audio_id, a.object_path, a.voice_map, a.segment_cues, a.digital_status, a.asr_roundtrip, a.technical_report, a.cast_snapshot,
             j.text_el, j.segments
      from public.audio_assets a join public.audio_jobs j on j.audio_id = a.audio_id where a.invalidated_at is null) t""") or []
    results = []
    t0 = time.time()
    for r in rows:
        res = {'audio_id': r['audio_id'], 'asset_id': r['id'], 'digital_status': r['digital_status'], 'voice_map': r['voice_map']}
        try:
            wav = http(f"{SUPA}/storage/v1/object/authenticated/course-audio/{r['object_path']}", None, {'Authorization': f'Bearer {SERVICE}', 'apikey': SERVICE}, 120)
            res['bytes'] = len(wav)
            res['acoustics'] = acoustics(wav, r.get('segment_cues') or [])
            ref = r.get('text_el') or ' '.join((s.get('text_el') or s.get('text') or '') for s in (r.get('segments') or []))
            res['script_words'] = len(words(ref))
            vt = res['acoustics']['voiced_time_s']
            res['syllables_per_s'] = round(syllables(ref) / vt, 2) if vt else None
            rt = r.get('asr_roundtrip') or {}
            res['stored_roundtrip'] = {k: rt.get(k) for k in ('pass', 'wer', 'cer_accent_insensitive', 'cer_phonetic', 'accent_mismatches', 'metric_version') if k in rt}
            if isinstance(rt.get('segments'), list):
                res['stored_failed_segments'] = [{k: s.get(k) for k in ('index', 'speaker', 'reference', 'hypothesis', 'wer', 'pass', 'accent_mismatches') if k in s} for s in rt['segments'] if s.get('pass') is False][:6]
            if time.time() - t0 < 2400:
                w = whisper_asr(wav)
                if w:
                    res['whisper'] = {'wer': wer(ref, w['text']), 'wer_accent_insensitive': wer_bare(ref, w['text']), 'stress_mismatches': stress_mismatches(ref, w['text'])[:8], 'text': w['text'][:400]}
        except Exception as e:  # noqa: BLE001
            res['error'] = str(e)[:200]
        results.append(res)
        print(json.dumps({'audio_id': res['audio_id'], 'status': res['digital_status'], 'dur': res.get('acoustics', {}).get('duration_s'), 'sps': res.get('syllables_per_s'), 'f0': res.get('acoustics', {}).get('f0'), 'w_wer': res.get('whisper', {}).get('wer_accent_insensitive'), 'err': res.get('error')}, ensure_ascii=False), flush=True)
    json.dump(results, open(f'{OUT}/assets.json', 'w'), ensure_ascii=False, indent=1)

# ---------------- 2. candidate voices ----------------
TEST_SET = [
    'Καλημέρα σας. Θα ήθελα έναν καφέ φρέντο, μέτριο, και ένα νερό, παρακαλώ.',
    'Πότε φεύγει το λεωφορείο για τη Θεσσαλονίκη; Ποτέ δεν αργεί τόσο.',
    'Ο νόμος ψηφίστηκε χθες, ενώ ο νομός Χαλκιδικής ετοιμάζεται για την τουριστική περίοδο.',
    'Το διαμέρισμα έχει δύο υπνοδωμάτια και κοστίζει τετρακόσια πενήντα ευρώ τον μήνα.',
    'Συγγνώμη, δεν κατάλαβα. Μπορείτε να το πείτε λίγο πιο αργά;',
    'Αν είχα περισσότερο χρόνο, θα μάθαινα να παίζω μπουζούκι.',
    'Η συνάντηση μεταφέρθηκε την Πέμπτη στις έξι και μισή το απόγευμα.',
    'Ε, καλά, δεν πειράζει! Τα λέμε αύριο στην πλατεία Αριστοτέλους.',
]

def tts(voice, locale, text):
    ssml = f'<speak version="1.0" xml:lang="el-GR"><voice name="{voice}"><lang xml:lang="el-GR">{text}</lang></voice></speak>' if not locale.startswith('el') else f'<speak version="1.0" xml:lang="el-GR"><voice name="{voice}">{text}</voice></speak>'
    return http(f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1', ssml.encode('utf-8'), {'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm', 'User-Agent': 'greekos-review'}, 60)

def voices():
    allv = json.loads(http(f'https://{REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list', None, {'Ocp-Apim-Subscription-Key': KEY}))
    cands = [v for v in allv if v.get('Locale') == 'el-GR' or 'el-GR' in (v.get('SecondaryLocaleList') or [])]
    # Native el-GR voices first, then multilingual ones that list el-GR (cap the count to stay well inside F0).
    cands.sort(key=lambda v: (v.get('Locale') != 'el-GR', v.get('ShortName')))
    cands = cands[:14]
    print(f'candidates: {[v["ShortName"] for v in cands]}', flush=True)
    out = []
    for v in cands:
        name, loc = v['ShortName'], v['Locale']
        row = {'voice': name, 'locale': loc, 'gender': v.get('Gender'), 'type': v.get('VoiceType'), 'sentences': []}
        try:
            for s in TEST_SET:
                wav = tts(name, loc, s)
                ac = acoustics(wav)
                az = azure_asr(wav)
                wh = whisper_asr(wav, detect=True)
                vt = ac['voiced_time_s']
                row['sentences'].append({
                    'text': s, 'duration_s': ac['duration_s'], 'syllables_per_s': round(syllables(s) / vt, 2) if vt else None, 'f0': ac['f0'],
                    'longest_pause_s': ac['longest_pause_s'],
                    'azure': {'wer_bare': wer_bare(s, az.get('text', '')), 'stress': stress_mismatches(s, az.get('text', '')), 'confidence': az.get('confidence'), 'text': az.get('text')},
                    'whisper': {'wer_bare': wer_bare(s, wh['text']), 'stress': stress_mismatches(s, wh['text']), 'lang': wh['language'], 'lang_p': wh['language_probability'], 'text': wh['text']} if wh else None,
                })
                time.sleep(3.2)  # F0: stay under 20 transactions per minute
        except Exception as e:  # noqa: BLE001
            row['error'] = str(e)[:200]
        ss = row['sentences']
        if ss:
            def mean(f):
                vals = [f(x) for x in ss if f(x) is not None]
                return round(sum(vals) / len(vals), 3) if vals else None
            row['summary'] = {
                'azure_wer_bare': mean(lambda x: x['azure']['wer_bare']), 'whisper_wer_bare': mean(lambda x: (x['whisper'] or {}).get('wer_bare')),
                'whisper_greek_p': mean(lambda x: (x['whisper'] or {}).get('lang_p') if (x['whisper'] or {}).get('lang') == 'el' else 0.0),
                'azure_confidence': mean(lambda x: x['azure']['confidence']), 'stress_mismatches': sum(len(x['azure']['stress']) + len((x['whisper'] or {}).get('stress') or []) for x in ss),
                'syllables_per_s': mean(lambda x: x['syllables_per_s']), 'f0_median_hz': mean(lambda x: (x['f0'] or {}).get('median_hz')), 'f0_range_st': mean(lambda x: (x['f0'] or {}).get('range_st')),
            }
        out.append(row)
        print(json.dumps({'voice': name, 'locale': loc, 'gender': row['gender'], 'summary': row.get('summary'), 'error': row.get('error')}, ensure_ascii=False), flush=True)
    json.dump(out, open(f'{OUT}/voices.json', 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    {'assets': assets, 'voices': voices}[sys.argv[1]]()
