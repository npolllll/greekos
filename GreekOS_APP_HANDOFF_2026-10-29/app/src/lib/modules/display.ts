/** Pure display helpers for the separate ΠΕΓΠ and Real Greek modules (Russian UI labels). */

// ---------- ΠΕΓΠ ----------
export const PEGP_TOPICS = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'] as const;
export type PegpTopic = (typeof PEGP_TOPICS)[number];

/** Topic of a ΠΕΓΠ item by its canonical ID (P01 items carry no batch prefix). */
export function pegpTopicOfItem(itemId: string): PegpTopic {
  const m = itemId.match(/^PEGP-(?:LANG-)?(P0[1-6])-/);
  return (m?.[1] as PegpTopic | undefined) ?? 'P01';
}

export const PEGP_DOMAIN_RU: Record<string, string> = { GEO: 'География', HIS: 'История', CUL: 'Культура', INS: 'Институты', LANG: 'Язык' };

export function pegpDomainOfItem(itemId: string): string {
  if (itemId.includes('-LANG-')) return 'LANG';
  const m = itemId.match(/-(GEO|HIS|CUL|INS)-/);
  return m?.[1] ?? 'LANG';
}

export interface PegpSourceRef {
  source_id: string | null;
  url: string | null;
  pdf_page: number | null;
  printed_page: number | null;
  official_topic: number | null;
  bank_version: string | null;
  checked_on: string | null;
  verification_scope: string | null;
}

/** Whitelist source metadata from original_payload.source_refs (never keys/rationale). */
export function pegpSourceRefs(originalPayload: Record<string, unknown> | null | undefined): PegpSourceRef[] {
  const refs = originalPayload?.source_refs;
  if (!Array.isArray(refs)) return [];
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return refs.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object').map((r) => ({
    source_id: s(r.source_id),
    url: s(r.url) && /^https:\/\//.test(r.url as string) ? (r.url as string) : null,
    pdf_page: n(r.pdf_page),
    printed_page: n(r.printed_page),
    official_topic: n(r.official_topic),
    bank_version: s(r.bank_version),
    checked_on: s(r.checked_on),
    verification_scope: s(r.verification_scope),
  }));
}

/** Catalog documents grouped by title family (e.g. «Κατανόηση Προφορικού Λόγου» topics). */
export function groupCatalog(docs: Array<{ title?: string; coverage?: string }>): Array<{ family: string; total: number; pending: number; linked: number }> {
  const map = new Map<string, { family: string; total: number; pending: number; linked: number }>();
  for (const d of docs) {
    const family = (d.title ?? 'Без названия').replace(/\s*-\s*Θέμα.*$/u, '').replace(/\s+/g, ' ').trim();
    const g = map.get(family) ?? { family, total: 0, pending: 0, linked: 0 };
    g.total += 1;
    if (d.coverage === 'NO_DIRECT_ITEM_LINK_FOUND') g.pending += 1;
    else g.linked += 1;
    map.set(family, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.family.localeCompare(b.family));
}

// ---------- Real Greek ----------
export const REGISTER_RU: Record<string, string> = {
  neutral: 'нейтральный',
  informal: 'неформальный',
  very_informal: 'очень неформальный',
  potentially_offensive: 'может прозвучать обидно',
  formal: 'формальный',
  slang: 'сленг',
};

export const CATEGORY_RU: Record<string, string> = {
  pragmatic_contrast: 'Прагматика: смысл зависит от подачи',
  discourse_marker: 'Дискурсивный маркер',
  regional: 'Региональное употребление',
  slang: 'Сленг',
  everyday_colloquial: 'Разговорное',
};

export const EVIDENCE_RU: Record<string, string> = {
  general_dictionary: 'общий словарь',
  community_only: 'только сообщество/форумы',
  two_different_authors: 'два независимых автора',
  lexicon: 'лексикон',
  historical_anecdotal_not_exclusive: 'исторические и анекдотические свидетельства, не исключительно региональное',
  historical_regional_plus2024_single_token: 'историческое региональное + единичный пример 2024 г.',
  historical_humor_not_exclusive: 'исторический юмор, не исключительно региональное',
};

export interface RgPayload {
  id: string;
  expression: string;
  category?: string;
  theory_ru?: string;
  meanings?: Array<{ gloss_ru?: string; intent?: string; polarity?: string; tone_audio_required?: boolean }>;
  contexts?: Array<{ setting?: string; relationship?: string; example_original?: string; neutral_alternative?: string; pitfall?: string; risk_interpretation?: string }>;
  register?: string[];
  region?: { tag?: string; evidence_strength?: string };
  audience?: { age_evidence?: string; time_period?: string; currentness?: string };
  safety?: { profanity_level?: number; sexual?: boolean; offensive?: boolean; disrespect?: boolean; register_mismatch?: boolean; receptive_only?: boolean; potential_disrespect_risk?: boolean; child_delivery?: string };
  source_evidence?: Array<{ source_id?: string; url?: string; specific_section?: string; publication_date?: string; checked_on?: string; verification?: string; source_type?: string; supports?: string; limitations?: string }>;
  audio_assets?: Array<{ item_id?: string; status?: string; audio_file?: string | null }>;
}

export function registerLabel(p: RgPayload): string {
  return (p.register ?? []).map((r) => REGISTER_RU[r] ?? r).join(', ') || 'не указан';
}

export function regionLabel(p: RgPayload): string {
  const tag = p.region?.tag ?? 'не указан';
  const ev = p.region?.evidence_strength;
  return ev ? `${tag} (основание: ${EVIDENCE_RU[ev] ?? ev})` : tag;
}

/** Attestation date from sources/audience; never invented — «неизвестно» when absent. */
export function attestationLabel(p: RgPayload): string {
  const dates = (p.source_evidence ?? []).map((s) => s.publication_date).filter((d): d is string => !!d && !/undated/i.test(d));
  const checked = (p.source_evidence ?? []).map((s) => s.checked_on).filter((d): d is string => !!d).sort();
  const parts: string[] = [];
  if (dates.length) parts.push(`датировка источников: ${[...new Set(dates)].join('; ')}`);
  if (p.audience?.time_period) parts.push(`период: ${p.audience.time_period}`);
  if (checked.length) parts.push(`проверено: ${checked.at(-1)}`);
  return parts.length ? parts.join(' · ') : 'неизвестно';
}

export const CURRENTNESS_RU: Record<string, string> = {
  CURRENT_PEDAGOGICAL_ATTESTATION_2026_NOT_FREQUENCY: 'Современное учебное подтверждение (2026), не данные о частотности',
  HISTORICAL_ATTESTATION_CURRENT_FREQUENCY_UNVERIFIED: 'Историческое подтверждение; современная частотность не проверена',
  CURRENT_DISTRIBUTION_UNVERIFIED: 'Современное распространение не проверено',
  CURRENT_ATTESTATION_2024_SINGLE_FORUM_NOT_PREVALENCE: 'Единичный пример 2024 г. на форуме — не распространённость',
  HISTORICAL_REGIONAL_ATTESTATION_CURRENT_FREQUENCY_UNVERIFIED: 'Историческое региональное подтверждение; частотность не проверена',
};

export function prosodyLabel(p: RgPayload): { status: string; text: string; available: boolean } {
  const statuses = (p.audio_assets ?? []).map((a) => a.status ?? 'UNKNOWN');
  const verified = statuses.some((s) => /VERIFIED/.test(s));
  if (!statuses.length) return { status: 'NO_AUDIO_PLAN', text: 'Аудио не запланировано — интонация не проверяется', available: false };
  if (verified) return { status: statuses.join(', '), text: 'Есть проверенный звуковой пример', available: true };
  return { status: statuses.join(', '), text: 'Интонация без звука не проверяется', available: false };
}

export function riskWarnings(p: RgPayload): string[] {
  const s = p.safety ?? {};
  const out: string[] = [];
  if ((s.profanity_level ?? 0) > 0) out.push('Содержит ненормативную или грубую лексику.');
  if (s.potential_disrespect_risk || s.disrespect) out.push('Может прозвучать неуважительно — с незнакомыми людьми используйте нейтральный вариант.');
  if (s.register_mismatch) out.push('Риск несоответствия регистру: уместность зависит от отношений и ситуации.');
  if (s.receptive_only) out.push('Рекомендуется только для понимания, не для активного употребления.');
  if (s.offensive) out.push('Может быть оскорбительным.');
  return out;
}
