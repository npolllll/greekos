/**
 * GreekOS executable digital content QA (v6). Pure, deterministic checks over one content object
 * plus a read-only context. Every finding names its check, field, severity and evidence; nothing
 * here is or claims to be a human (teacher/examiner/native speaker) verification.
 *
 * Severity: blocking → cannot be released until fixed (or explicitly accepted by the owner where the
 * rule allows it); warning → release needs explicit owner risk acceptance; info → recorded only.
 */
import { contentHash, stableStringify } from '../content/stable-json.ts';
import { adapterFor, choiceOptions, hasOptions, type ItemEnvelope } from '../content/types.ts';
import { keyedOptions } from '../scoring/score.ts';
import { normalizeByPolicy } from '../scoring/normalize.ts';

export const QA_TOOL_VERSION = 'greekos-digital-qa/2.0';

export type Severity = 'blocking' | 'warning' | 'info';
export interface Finding {
  check_id: string;
  severity: Severity;
  field: string | null;
  message_ru: string;
  evidence?: Record<string, unknown>;
  suggestion?: string | null;
}

export interface CheckDef { id: string; group: string; title_ru: string; severity: Severity }

/** Catalogue of checks (stored with every batch so a report is self-describing). */
export const CHECKS: CheckDef[] = [
  { id: 'hash.envelope', group: 'Неизменность', title_ru: 'SHA-256 канонизированного задания совпадает с текущим хешем', severity: 'blocking' },
  { id: 'hash.revision', group: 'Неизменность', title_ru: 'Текущая ревизия хранит тот же payload и хеш', severity: 'blocking' },
  { id: 'schema.adapter', group: 'Схема', title_ru: 'Тип задания поддерживается интерфейсом (иначе не рендерится)', severity: 'blocking' },
  { id: 'schema.required', group: 'Схема', title_ru: 'Обязательные поля: формулировка, уровень, тип', severity: 'blocking' },
  { id: 'refs.unit', group: 'Ссылки', title_ru: 'Урок существует', severity: 'blocking' },
  { id: 'refs.competencies', group: 'Ссылки', title_ru: 'Все компетенции существуют', severity: 'blocking' },
  { id: 'refs.audio_jobs', group: 'Ссылки', title_ru: 'Все аудиозадания существуют', severity: 'blocking' },
  { id: 'refs.rubric', group: 'Ссылки', title_ru: 'Рубрика существует', severity: 'blocking' },
  { id: 'refs.text_object', group: 'Ссылки', title_ru: 'Текст-стимул существует', severity: 'blocking' },
  { id: 'keys.present', group: 'Ключи', title_ru: 'У задания с автоматическим ключом есть ключ', severity: 'blocking' },
  { id: 'keys.choice_resolves', group: 'Ключи', title_ru: 'Ключ выбора указывает ровно на заданные варианты', severity: 'blocking' },
  { id: 'keys.options_duplicate', group: 'Ключи', title_ru: 'Нет повторяющихся вариантов ответа', severity: 'blocking' },
  { id: 'keys.alternatives_duplicate', group: 'Ключи', title_ru: 'Допустимые варианты не дублируют друг друга', severity: 'info' },
  { id: 'keys.key_in_prompt', group: 'Ключи', title_ru: 'Ответ не подсказан дословно в формулировке', severity: 'warning' },
  { id: 'scoring.review_basis', group: 'Оценивание', title_ru: 'Для ручной/AI-оценки есть критерии, рубрика или образец', severity: 'warning' },
  { id: 'ortho.final_sigma', group: 'Орфография', title_ru: 'Конечная сигма: ς в конце слова, σ внутри', severity: 'blocking' },
  { id: 'ortho.mixed_script', group: 'Орфография', title_ru: 'В греческих словах нет латинских/кириллических двойников букв', severity: 'blocking' },
  { id: 'ortho.missing_accent', group: 'Орфография', title_ru: 'Многосложные слова имеют знак ударения', severity: 'warning' },
  { id: 'ortho.monosyllable_accent', group: 'Орфография', title_ru: 'Нет лишнего ударения в односложных словах', severity: 'warning' },
  { id: 'ortho.double_accent', group: 'Орфография', title_ru: 'Два ударения только перед энклитикой', severity: 'warning' },
  { id: 'ortho.spelling', group: 'Орфография', title_ru: 'Слова есть в словаре hunspell el_GR (имена — информационно)', severity: 'warning' },
  { id: 'ortho.question_mark', group: 'Орфография', title_ru: 'Греческий вопрос оформлен «;», а не «?»', severity: 'warning' },
  { id: 'ortho.unicode', group: 'Орфография', title_ru: 'Текст в NFC, без политонических/оксийных вариантов', severity: 'warning' },
  { id: 'ortho.spacing', group: 'Орфография', title_ru: 'Нет двойных пробелов и пробела перед знаком', severity: 'info' },
  { id: 'level.consistency', group: 'Уровень', title_ru: 'Уровень задания согласован с уроком и компетенциями', severity: 'warning' },
  { id: 'level.text_length', group: 'Уровень', title_ru: 'Длина греческого текста соответствует уровню', severity: 'info' },
  { id: 'modality.audio', group: 'Модальность', title_ru: 'Задание на аудирование имеет проверенное аудио', severity: 'info' },
  { id: 'modality.spoken', group: 'Модальность', title_ru: 'Устное задание помечено как требующее речи', severity: 'info' },
  { id: 'sources.claims', group: 'Источники', title_ru: 'Ссылки на источники существуют и их статус известен', severity: 'info' },
  { id: 'rights.license', group: 'Права', title_ru: 'Права на материал задокументированы и допускают распространение', severity: 'blocking' },
  { id: 'human.review', group: 'Экспертиза', title_ru: 'Независимая экспертиза человеком (не выполняется автоматически)', severity: 'info' },
];

// ---------------- Greek text helpers ----------------

const GREEK = /[Ͱ-Ͽἀ-῿]/u;
const WORD = /[\p{L}́̈]+/gu;
const TONOS = /[άέήίόύώΐΰΆΈΉΊΌΎΏ]/u;
const VOWELS = /[αεηιουωάέήίόύώϊϋΐΰ]/giu;
const HOMOGLYPHS = /[A-Za-zА-Яа-яЁё]/u;
// Monosyllables that legitimately carry an accent (disambiguation / interrogatives).
const ACCENTED_MONO = new Set(['ή', 'πού', 'πώς', 'Ή', 'Πού', 'Πώς']);
const ENCLITICS = new Set(['μου', 'σου', 'του', 'της', 'μας', 'σας', 'τους', 'το', 'τα', 'τον', 'την', 'τη', 'τις', 'τες', 'με', 'σε']);
// Monosyllables by synizesis that are often wrongly accented (πιό, μιά, γιά, ποιός…).
const SYNIZESIS_MONO = /^(πι[οό]|μι[αά]ς?|γι[αά]|γει[αά]|πι[αά]|ποι[οό][ςυνι]?|ποι[αά]ς?|ποι[εέ]ς|δυ[οό])$/u;

export function isGreekWord(w: string): boolean {
  return GREEK.test(w);
}

const PLAIN_VOWEL = 'αεηιουω';
const ACC: Record<string, string> = { ά: 'α', έ: 'ε', ή: 'η', ί: 'ι', ό: 'ο', ύ: 'υ', ώ: 'ω', ϊ: 'ι', ϋ: 'υ', ΐ: 'ι', ΰ: 'υ' };
const DIGRAPH = new Set(['αι', 'ει', 'οι', 'ου', 'υι', 'αυ', 'ευ', 'ηυ']);

/**
 * Spoken syllables of a Modern Greek word. Digraphs count once unless the accent sits on their
 * first letter (τσά-ι) or the second has a diaeresis (Μαΐου); an unaccented ι/υ/ει/οι before
 * another vowel is a glide (synizesis: για, μια, ποιος, δυο, γεια are monosyllables).
 */
export function syllables(w: string): number {
  const chars = [...w.normalize('NFC').toLowerCase()];
  const base = (c: string) => ACC[c] ?? c;
  const isV = (c: string | undefined) => !!c && PLAIN_VOWEL.includes(base(c));
  const accented = (c: string | undefined) => !!c && !!ACC[c] && !'ϊϋ'.includes(c);
  let n = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (!isV(c)) continue;
    const next = chars[i + 1];
    const pair = isV(next) && !accented(c) && !'ϊϋΐΰ'.includes(next!) && DIGRAPH.has(base(c) + base(next!));
    const unitLen = pair ? 2 : 1;
    const unit = pair ? base(c) + base(next!) : base(c);
    const unitAccented = accented(c) || (pair && accented(next));
    // A glide only before an UNACCENTED vowel: an accent after ι marks hiatus (τρι-ών).
    const glide = !unitAccented && i > 0 && isV(chars[i + unitLen]) && !accented(chars[i + unitLen]) && ['ι', 'υ', 'ει', 'οι'].includes(unit);
    if (!glide) n += 1;
    i += unitLen - 1;
  }
  return n;
}

/** All Greek strings worth checking in an item, keyed by field name. */
export function greekFields(e: ItemEnvelope): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  const push = (field: string, v: unknown) => {
    if (typeof v === 'string' && GREEK.test(v)) out.push({ field, text: v });
  };
  push('prompt', e.prompt);
  const st = e.stimulus as Record<string, unknown> | null;
  if (typeof e.stimulus === 'string') push('stimulus', e.stimulus);
  else if (st && typeof st === 'object') {
    for (const [k, v] of Object.entries(st)) {
      if (typeof v === 'string' && k !== 'asset_id' && k !== 'text_id') push(`stimulus.${k}`, v);
      if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'string' ? push(`stimulus.${k}[${i}]`, x) : x && typeof x === 'object' && push(`stimulus.${k}[${i}]`, (x as { text?: string }).text)));
    }
  }
  choiceOptions(e.options).forEach((o, i) => push(`options[${i}]`, o.label));
  (e.answer ?? []).forEach((a, i) => push(`answer[${i}]`, a));
  (e.accepted_alternatives ?? []).forEach((a, i) => push(`accepted_alternatives[${i}]`, a));
  push('model_response', typeof e.model_response === 'string' ? e.model_response : null);
  return out;
}

export interface OrthographyContext {
  /** Words hunspell el_GR does not know (lower-cased NFC); null when the dictionary is unavailable. */
  unknownWords: Set<string> | null;
}

/** Orthography findings for one Greek string. */
export function orthography(field: string, text: string, ctx: OrthographyContext): Finding[] {
  const out: Finding[] = [];
  if (text.normalize('NFC') !== text) out.push({ check_id: 'ortho.unicode', severity: 'warning', field, message_ru: 'Текст не в нормальной форме NFC (составные диакритики).', evidence: { sample: text.slice(0, 60) } });
  if (/[ἀ-῿]/u.test(text)) out.push({ check_id: 'ortho.unicode', severity: 'warning', field, message_ru: 'Политонические символы или оксия (U+1Fxx) вместо монотонического тоноса.', evidence: { chars: [...new Set(text.match(/[ἀ-῿]/gu) ?? [])] } });
  if (/ {2,}/.test(text) || / [,.;:!·]/.test(text)) out.push({ check_id: 'ortho.spacing', severity: 'info', field, message_ru: 'Двойной пробел или пробел перед знаком препинания.' });
  // Greek question: a Latin "?" closing a sentence that is itself Greek (≥3 Greek words, no Cyrillic).
  const q = [...text.matchAll(/([^.;!?\n:]*)\?/gu)].map((m) => m[1]).find((sent) => greekShare(sent) > 0.95 && (sent.match(WORD) ?? []).filter(isGreekWord).length >= 3);
  if (q) out.push({ check_id: 'ortho.question_mark', severity: 'warning', field, message_ru: 'В греческом вопросе используется «;», а не «?».', evidence: { at: q.slice(-40) }, suggestion: text.replace(/\?/g, ';') });
  const norm = text.normalize('NFC');
  const tokens = [...norm.matchAll(WORD)].map((m) => ({ w: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const words = tokens.map((t) => t.w);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!isGreekWord(w)) continue;
    const before = norm[tokens[i].start - 1] ?? ' ';
    const after = norm[tokens[i].end] ?? ' ';
    // Elided forms (δώσ' μου, στείλ' το) and notation fragments (γρά-φω, -ής, σ/ς) are not words.
    const elided = /['’ʼ]/u.test(after);
    const fragment = /[-‑–/]/u.test(before) || /[-‑–/]/u.test(after) || [...w].length <= 1 || !/[αεηιουωάέήίόύώϊϋΐΰ]/iu.test(w);
    if (HOMOGLYPHS.test(w)) {
      out.push({ check_id: 'ortho.mixed_script', severity: 'blocking', field, message_ru: `В слове «${w}» смешаны греческие и латинские/кириллические буквы.`, evidence: { word: w, foreign: w.match(/[A-Za-zА-Яа-яЁё]/gu) } });
      continue;
    }
    if (fragment) continue;
    if (/σ$/u.test(w) && w.length > 1 && !elided) out.push({ check_id: 'ortho.final_sigma', severity: 'blocking', field, message_ru: `«${w}»: в конце слова пишется ς.`, evidence: { word: w }, suggestion: w.replace(/σ$/u, 'ς') });
    if (/ς(?=\p{L})/u.test(w)) out.push({ check_id: 'ortho.final_sigma', severity: 'blocking', field, message_ru: `«${w}»: ς стоит внутри слова.`, evidence: { word: w } });
    const isUpper = w === w.toUpperCase();
    const syl = syllables(w);
    const accents = (w.match(/[άέήίόύώΐΰΆΈΉΊΌΎΏ]/gu) ?? []).length;
    if (!isUpper && syl >= 2 && accents === 0 && !/[ϊϋ]/u.test(w)) {
      out.push({ check_id: 'ortho.missing_accent', severity: 'warning', field, message_ru: `«${w}»: многосложное слово без ударения.`, evidence: { word: w } });
    }
    if (accents > 0 && SYNIZESIS_MONO.test(w.toLowerCase()) && !ACCENTED_MONO.has(w)) {
      out.push({ check_id: 'ortho.monosyllable_accent', severity: 'warning', field, message_ru: `«${w}»: односложное по синизезе слово пишется без ударения.`, evidence: { word: w }, suggestion: w.normalize('NFD').replace(/\u0301/g, '').normalize('NFC') });
    } else if (syl === 1 && accents > 0 && !ACCENTED_MONO.has(w) && !elided) {
      out.push({ check_id: 'ortho.monosyllable_accent', severity: 'warning', field, message_ru: `«${w}»: односложное слово обычно пишется без ударения.`, evidence: { word: w }, suggestion: w.normalize('NFD').replace(/́/g, '').normalize('NFC') });
    }
    if (accents >= 2 && !ENCLITICS.has((words[i + 1] ?? '').toLowerCase())) {
      out.push({ check_id: 'ortho.double_accent', severity: 'warning', field, message_ru: `«${w}»: два ударения допустимы только перед энклитикой (το όνομά μου).`, evidence: { word: w, next: words[i + 1] ?? null } });
    }
    if (ctx.unknownWords && ctx.unknownWords.has(w.toLowerCase()) && !isUpper && !elided && [...w].length > 2 && !(accents >= 2 && ENCLITICS.has((words[i + 1] ?? '').toLowerCase()))) {
      const capitalised = w[0] !== w[0].toLowerCase();
      out.push({ check_id: 'ortho.spelling', severity: capitalised ? 'info' : 'warning', field, message_ru: capitalised ? `«${w}» нет в словаре (вероятно, имя собственное).` : `«${w}» нет в словаре hunspell el_GR — проверить написание.`, evidence: { word: w } });
    }
  }
  return out;
}

function greekShare(s: string): number {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => GREEK.test(c)).length / letters.length : 0;
}

// ---------------- Item checks ----------------

export interface QaContext {
  units: Map<string, { level: string; current_hash: string }>;
  competencies: Map<string, { level: string | null }>;
  audioJobs: Set<string>;
  verifiedAudio: Set<string>;
  rubrics: Set<string>;
  textObjects: Set<string>;
  claims: Map<string, { status: string | null }>;
  itemClaims: Map<string, string[]>;
  revisions: Map<number, { content_hash: string; payload: unknown }>;
  ortho: OrthographyContext;
}

export interface ItemForQa {
  item_id: string;
  module: string;
  unit_id: string | null;
  item_type: string;
  level: string | null;
  scoring_strategy: string;
  requires_audio: boolean;
  competency_ids: string[];
  audio_job_ids: string[];
  envelope: ItemEnvelope;
  current_hash: string;
  revision_id: number;
}

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1'];
const MAX_WORDS: Record<string, number> = { A1: 120, A2: 220, B1: 450, B2: 900 };
const KEYED = new Set(['CHOICE_KEY', 'EXACT_WITH_REVIEW_FALLBACK', 'STRUCTURED_WITH_REVIEW_FALLBACK']);

export function checkItem(it: ItemForQa, ctx: QaContext): Finding[] {
  const f: Finding[] = [];
  const e = it.envelope;
  // Immutability
  const h = contentHash(e);
  if (h !== it.current_hash) f.push({ check_id: 'hash.envelope', severity: 'blocking', field: null, message_ru: 'Хеш содержимого не совпадает с сохранённым — задание изменено вне процедуры ревизий.', evidence: { computed: h, stored: it.current_hash } });
  const rev = ctx.revisions.get(it.revision_id);
  if (!rev || rev.content_hash !== it.current_hash || stableStringify(rev.payload) !== stableStringify(e)) f.push({ check_id: 'hash.revision', severity: 'blocking', field: null, message_ru: 'Текущая ревизия не содержит этот payload/хеш.', evidence: { revision_id: it.revision_id } });
  // Schema
  if (!adapterFor(it.item_type, e.options)) f.push({ check_id: 'schema.adapter', severity: 'blocking', field: 'type', message_ru: `Тип «${it.item_type}» не поддерживается интерфейсом (без вариантов для выбора или неизвестный тип).`, evidence: { type: it.item_type, has_options: hasOptions(e.options) } });
  if (!e.prompt?.trim()) f.push({ check_id: 'schema.required', severity: 'blocking', field: 'prompt', message_ru: 'Пустая формулировка задания.' });
  if (it.level && !LEVEL_ORDER.includes(it.level)) f.push({ check_id: 'schema.required', severity: 'blocking', field: 'level', message_ru: `Неизвестный уровень «${it.level}».` });
  // References
  if (it.unit_id && !ctx.units.has(it.unit_id)) f.push({ check_id: 'refs.unit', severity: 'blocking', field: 'unit_id', message_ru: `Урок ${it.unit_id} не найден.` });
  const missingComp = it.competency_ids.filter((c) => !ctx.competencies.has(c));
  if (missingComp.length) f.push({ check_id: 'refs.competencies', severity: 'blocking', field: 'competency_ids', message_ru: `Нет компетенций: ${missingComp.join(', ')}.`, evidence: { missing: missingComp } });
  const missingAudio = it.audio_job_ids.filter((a) => !ctx.audioJobs.has(a));
  if (missingAudio.length) f.push({ check_id: 'refs.audio_jobs', severity: 'blocking', field: 'audio_job_ids', message_ru: `Нет аудиозаданий: ${missingAudio.join(', ')}.` });
  if (typeof e.rubric === 'string' && !ctx.rubrics.has(e.rubric)) f.push({ check_id: 'refs.rubric', severity: 'blocking', field: 'rubric', message_ru: `Рубрика ${e.rubric} не найдена.` });
  const textId = (e.stimulus as { text_id?: string } | null)?.text_id;
  if (typeof textId === 'string' && !ctx.textObjects.has(textId)) f.push({ check_id: 'refs.text_object', severity: 'blocking', field: 'stimulus.text_id', message_ru: `Текст ${textId} не найден.` });
  // Keys
  const answers = (e.answer ?? []).filter((x): x is string => typeof x === 'string');
  if (KEYED.has(it.scoring_strategy) && !answers.length) f.push({ check_id: 'keys.present', severity: 'blocking', field: 'answer', message_ru: 'Автоматический ключ пуст — задание нельзя проверить.' });
  const kind = adapterFor(it.item_type, e.options);
  if (kind === 'choice') {
    const opts = choiceOptions(e.options);
    const labels = opts.map((o) => o.label.normalize('NFC').trim());
    const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
    if (dup.length) f.push({ check_id: 'keys.options_duplicate', severity: 'blocking', field: 'options', message_ru: `Повторяющиеся варианты: ${[...new Set(dup)].join(', ')}.` });
    if (answers.length && !keyedOptions(e, opts)) f.push({ check_id: 'keys.choice_resolves', severity: 'blocking', field: 'answer', message_ru: 'Ключ не совпадает ни с одним вариантом или после нормализации указывает на несколько вариантов.', evidence: { answer: answers, options: labels } });
  }
  const st = (e.scoring?.policy?.normalization as string[] | undefined) ?? undefined;
  const altsNorm = [...answers, ...(e.accepted_alternatives ?? []).filter((x): x is string => typeof x === 'string')].map((a) => normalizeByPolicy(a, st));
  if (new Set(altsNorm).size < altsNorm.length) f.push({ check_id: 'keys.alternatives_duplicate', severity: 'info', field: 'accepted_alternatives', message_ru: 'Некоторые допустимые варианты совпадают после нормализации.' });
  if (kind !== 'choice' && answers.length && answers.some((a) => a.trim().length >= 4 && e.prompt.includes(a.trim())) && it.item_type !== 'error_correction') {
    f.push({ check_id: 'keys.key_in_prompt', severity: 'warning', field: 'prompt', message_ru: 'Ответ дословно присутствует в формулировке — проверьте, не подсказан ли он.', evidence: { answer: answers.find((a) => e.prompt.includes(a.trim())) } });
  }
  if (it.scoring_strategy === 'REVIEW_REQUIRED' && !e.rubric && !(e.criteria ?? []).length && !e.model_response) {
    f.push({ check_id: 'scoring.review_basis', severity: 'warning', field: 'rubric', message_ru: 'Нет рубрики, критериев и образца — ответ сможет оценить только человек без опоры.' });
  }
  // Orthography over every Greek string
  for (const { field, text } of greekFields(e)) f.push(...orthography(field, text, ctx.ortho));
  // Level
  const unit = it.unit_id ? ctx.units.get(it.unit_id) : undefined;
  if (unit && it.level && unit.level !== it.level) f.push({ check_id: 'level.consistency', severity: 'warning', field: 'level', message_ru: `Уровень задания ${it.level} ≠ уровень урока ${unit.level}.` });
  const compLevels = it.competency_ids.map((c) => ctx.competencies.get(c)?.level).filter((x): x is string => !!x && LEVEL_ORDER.includes(x));
  if (it.level && compLevels.some((l) => LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(it.level!) + 1)) f.push({ check_id: 'level.consistency', severity: 'warning', field: 'competency_ids', message_ru: 'Компетенция задания выше уровня задания более чем на одну ступень.', evidence: { item_level: it.level, competency_levels: compLevels } });
  const stimulusText = greekFields(e).filter((x) => x.field.startsWith('stimulus')).map((x) => x.text).join(' ');
  const words = (stimulusText.match(WORD) ?? []).length;
  if (it.level && MAX_WORDS[it.level] && words > MAX_WORDS[it.level]) f.push({ check_id: 'level.text_length', severity: 'info', field: 'stimulus', message_ru: `Текст ${words} слов — больше типичного для ${it.level} (${MAX_WORDS[it.level]}).` });
  // Modality
  if (it.requires_audio && it.audio_job_ids.length && !it.audio_job_ids.every((a) => ctx.verifiedAudio.has(a))) {
    f.push({ check_id: 'modality.audio', severity: 'info', field: 'audio_job_ids', message_ru: 'Нет аудио, прошедшего цифровую проверку: задание откроется только после выпуска аудио (транскрипт звук не заменяет).' });
  }
  if (it.requires_audio && !it.audio_job_ids.length) f.push({ check_id: 'modality.spoken', severity: 'info', field: 'requires_audio', message_ru: 'Требуется речь ученика (не стимул): оценивается только по подтверждённому транскрипту.' });
  // Sources and rights
  const claimIds = ctx.itemClaims.get(it.item_id) ?? [];
  const unknownClaims = claimIds.filter((c) => !ctx.claims.has(c));
  if (unknownClaims.length) f.push({ check_id: 'sources.claims', severity: 'warning', field: 'source_claim_ids', message_ru: `Нет записей источников: ${unknownClaims.join(', ')}.` });
  const notReverified = claimIds.filter((c) => (ctx.claims.get(c)?.status ?? '').includes('NOT_REVERIFIED')).length;
  if (notReverified) f.push({ check_id: 'sources.claims', severity: 'info', field: 'source_claim_ids', message_ru: `${notReverified} ссылок на источники с унаследованной атрибуцией, не перепроверенной заново.` });
  const lic = (e.original_payload?.licensing ?? null) as Record<string, unknown> | null;
  if (!lic) f.push({ check_id: 'rights.license', severity: 'blocking', field: 'original_payload.licensing', message_ru: 'Нет блока прав (licensing): нельзя подтвердить право распространения.', suggestion: 'Задокументировать происхождение материала или принять риск отдельным решением владельца.' });
  else if (lic.third_party_assets === true || lic.commercial_web_distribution_allowed === false) f.push({ check_id: 'rights.license', severity: 'blocking', field: 'original_payload.licensing', message_ru: 'Права ограничены (сторонние материалы или запрет распространения).', evidence: lic });
  f.push({ check_id: 'human.review', severity: 'info', field: null, message_ru: 'Независимая проверка преподавателем/носителем не проводилась (цифровой QA её не заменяет).' });
  return f;
}

export function verdictOf(findings: Finding[], abstained: string[] = []): 'PASS' | 'NEEDS_REVIEW' | 'FAIL' | 'ABSTAIN' {
  if (findings.some((x) => x.severity === 'blocking')) return 'FAIL';
  if (findings.some((x) => x.severity === 'warning')) return 'NEEDS_REVIEW';
  if (abstained.length) return 'NEEDS_REVIEW';
  return 'PASS';
}

/** Collect every Greek word of a list of texts (for one batched dictionary lookup). */
export function collectGreekWords(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of t.normalize('NFC').match(WORD) ?? []) if (isGreekWord(w) && !HOMOGLYPHS.test(w)) out.add(w.toLowerCase());
  return out;
}

export function tonosOf(w: string): boolean {
  return TONOS.test(w);
}

export function vowelCount(w: string): number {
  return (w.match(VOWELS) ?? []).length;
}
