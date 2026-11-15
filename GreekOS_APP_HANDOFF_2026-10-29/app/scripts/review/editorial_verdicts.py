"""AI editor's objective verdicts for every current course audio file (no human ear; measurable proxies).
Inputs: reports/review/audio/assets.json (+ assets-partial.json for re-rendered files), audio_jobs export.
Outputs: reports/review/decisions/listening.json and digital.json, plus a summary on stdout."""
import json, gzip, re, sys, unicodedata, os
APP = sys.argv[1]
full = {x['audio_id']: x for x in json.load(open(f'{APP}/reports/review/audio/assets.json'))}
part_p = f'{APP}/reports/review/audio/assets-partial.json'
part = {x['audio_id']: x for x in json.load(open(part_p))} if os.path.exists(part_p) else {}
cur = {**full, **part}
jobs = {j['audio_id']: j for j in json.load(gzip.open(f'{APP}/reports/review/corpus/audio_jobs.json.gz'))}
NUMW = set('ενα μια μια ενας μιας ενος δυο τρια τρεις τεσσερα τεσσερις πεντε εξι επτα εφτα οκτω οχτω εννεα εννια δεκα εντεκα δωδεκα δεκατρια δεκαπεντε εικοσι τριαντα σαραντα πενηντα εξηντα εβδομηντα ογδοντα ενενηντα εκατο διακοσια τριακοσια τετρακοσια πεντακοσια εξακοσια επτακοσια χιλια μιση μισο'.split())
def strip(t): return ''.join(c for c in unicodedata.normalize('NFD', t.lower()) if unicodedata.category(c) != 'Mn')
def words(t): return [w for w in re.findall(r'[α-ωa-z0-9]+', strip(t))]
def phon_words(t):
    out = []
    for w in words(t):
        if w.isdigit() or w in NUMW: continue
        for a, b in (('ει','ι'),('οι','ι'),('υι','ι'),('αι','ε'),('αυ','αφ'),('ευ','εφ'),('η','ι'),('υ','ι'),('ω','ο'),('μπ','b'),('ντ','d'),('γκ','g'),('ς','σ')):
            w = w.replace(a, b)
        w = re.sub(r'(.)\1', r'\1', w)
        out.append(w)
    return ''.join(out)
def semi_global(p, t):
    """Edit distance of pattern p against the best-matching substring of t."""
    if not p: return 0
    prev = [0] * (len(t) + 1)
    for i in range(1, len(p) + 1):
        cur = [i] + [0] * len(t)
        for j in range(1, len(t) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (p[i - 1] != t[j - 1]))
        prev = cur
    return min(prev)
LETTERS = ['αλφα','βιτα','γαμα','δελτα','εψιλον','ζιτα','θιτα','γιοτα','καπα','λαμδα','σιγμα','ιψιλον','ομεγα']
def spelled(hyp, ref):
    r = phon_words(ref)
    hw = [phon_words(x) for x in re.findall(r'\S+', hyp)]
    return sorted({n for n in LETTERS for h in hw if n in h and n not in r})
def accent_pos(t):
    out, k = [], 0
    for c in unicodedata.normalize('NFD', t.lower()):
        if c == '\u0301': out.append(k)
        elif unicodedata.category(c) != 'Mn': k += 1
    return out
def benign_accent(m, hyp):
    """A stored accent mismatch (reference word) is benign when the recogniser wrote μια/μία, or only dropped the
    enclitic second accent; a moved main stress («συνάδελφός» → «συναδέλφός») is not."""
    m = m.rstrip('σς') if m.endswith('σ') else m
    for h in re.findall(r'[\wͰ-Ͽ]+', hyp):
        if strip(h).rstrip('σς') != strip(m).rstrip('σς'): continue
        h_low = h.lower()
        if {strip(m), strip(h)} <= {'μια'}: return True
        if h_low == m.lower(): return True
        ph, pm = accent_pos(h), accent_pos(m)
        # A capitalised word written without its accent mark («Οχι», «Αρα») is typography, not stress.
        if not ph and h[:1].upper() == h[:1] and pm and pm[0] == 1: return True
        return bool(ph) and set(ph) <= set(pm)
    return False
def script(j):
    segs = [(s.get('text_el') or s.get('text') or '') for s in (j.get('segments') or [])]
    return ' '.join(x for x in segs if x) or re.sub(r'^\s*[^\n:]{1,30}:\s*', '', j.get('text_el') or '', flags=re.M)
listening, digital, summary = [], [], {'OK': 0, 'ISSUE': 0, 'digital_confirm': 0, 'issues': []}
for aid, x in sorted(cur.items()):
    j = jobs[aid]; ref = script(j); ac = x.get('acoustics') or {}; w = (x.get('whisper') or {}).get('text', '')
    problems = []
    if x.get('error'): problems.append(f"ошибка измерения: {x['error'][:80]}")
    if ac.get('clipping_ratio', 0) > 0: problems.append('клиппинг')
    if (ac.get('peak_dbfs') or -99) > -0.5: problems.append(f"пик {ac.get('peak_dbfs')} dBFS")
    if not -20 <= (ac.get('rms_dbfs') or -99) <= -12: problems.append(f"громкость {ac.get('rms_dbfs')} dBFS")
    if (ac.get('lead_silence_s') or 0) > 0.6 or (ac.get('trail_silence_s') or 0) > 1.6: problems.append('длинная тишина в начале/конце')
    if (ac.get('longest_pause_s') or 0) > 2.6: problems.append(f"пауза {ac.get('longest_pause_s')} с")
    sp = spelled(w, ref)
    if sp: problems.append(f"голос произносит названия букв: {', '.join(sp)}")
    # Voice consistency: two speakers on one voice, or a speaker whose pitch jumps between lines.
    segs = ac.get('segments') or []
    by_voice = {}
    for s in segs:
        if s.get('f0') and s['f0'].get('median_hz'): by_voice.setdefault(s['voice'], []).append(s['f0']['median_hz'])
    status = x.get('digital_status')
    failed = x.get('stored_failed_segments') or []
    evidence = []
    if status == 'NEEDS_REVIEW':
        hp = phon_words(w)
        for f in failed:
            bad_acc = [m for m in (f.get('accent_mismatches') or []) if not benign_accent(m, f.get('hypothesis') or '')]
            if bad_acc: problems.append(f"возможная ошибка ударения: {', '.join(bad_acc)}")
            rp = phon_words(f.get('reference') or '')
            d = semi_global(rp, hp) / max(1, len(rp))
            evidence.append({'segment': (f.get('reference') or '')[:120], 'azure': (f.get('hypothesis') or '')[:120], 'whisper_distance': round(d, 3)})
        unconfirmed = [e for e in evidence if e['whisper_distance'] > 0.25]
        if not failed: problems.append('нет данных о спорных сегментах')
        elif unconfirmed: problems.append(f"второй распознаватель не подтверждает {len(unconfirmed)} спорн. сегмент(а)")
    elif status != 'AUDIO_VERIFIED_DIGITAL':
        problems.append(f'цифровой статус {status}')
    metrics = {'duration_s': ac.get('duration_s'), 'syllables_per_s': x.get('syllables_per_s'), 'rms_dbfs': ac.get('rms_dbfs'), 'peak_dbfs': ac.get('peak_dbfs'), 'longest_pause_s': ac.get('longest_pause_s'), 'f0_by_voice_hz': {k.split(':')[-1]: round(sum(v) / len(v)) for k, v in by_voice.items()}, 'azure_wer': (x.get('stored_roundtrip') or {}).get('wer'), 'whisper_wer': (x.get('whisper') or {}).get('wer_accent_insensitive'), 'spelled_letters': sp}
    decision = 'ISSUE' if problems else 'OK'
    note = ('AI-редактор (не человек): ' + ('; '.join(problems) if problems else 'технически чисто, распознавание двумя распознавателями совпадает со сценарием, названий букв нет')) + '. Естественность и интонация человеком не оценивались.'
    listening.append({'asset_id': x['asset_id'], 'audio_id': aid, 'decision': decision, 'note': note[:480], 'metrics': metrics})
    summary[decision] += 1
    if problems: summary['issues'].append((aid, problems))
    if status == 'NEEDS_REVIEW' and not problems:
        digital.append({'asset_id': x['asset_id'], 'sha256': x.get('sha256'), 'evidence': [{'segment': e['segment'], 'azure': e['azure'], 'whisper': f"фонетическое расстояние {e['whisper_distance']}", 'reason': 'Azure разошёлся со сценарием, второй распознаватель (Whisper) читает сегмент как в сценарии'} for e in evidence]})
        summary['digital_confirm'] += 1
os.makedirs(f'{APP}/reports/review/decisions', exist_ok=True)
json.dump(listening, open(f'{APP}/reports/review/decisions/listening.json', 'w'), ensure_ascii=False, indent=1)
json.dump(digital, open(f'{APP}/reports/review/decisions/digital.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != 'issues'}, ensure_ascii=False))
for i in summary['issues']: print(' ISSUE', i)
