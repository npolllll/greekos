/** Russian labels shared by admin server pages and client components (no server-only imports). */

export const LIFECYCLE_LABEL: Record<string, string> = {
  invited: 'Приглашён', activated: 'Активирован', foundations: 'Основы чтения', placement_pending: 'Ждёт диагностики',
  placement_in_progress: 'Диагностика', provisional_route: 'Предварительный маршрут', placement_verified: 'Маршрут подтверждён',
  studying: 'Учится', inactive: 'Неактивен',
};

export const ENTRY_LABEL: Record<string, string> = { from_zero: 'С полного нуля', prior_learning: 'Уже изучал(а)', unsure: 'Не уверен(а)' };

export const REVIEW_TYPE_LABEL: Record<string, string> = {
  OWNER_DIGITAL_POLICY: 'Решение владельца по цифровой политике (без независимой экспертизы)',
  HUMAN_TEACHER_REVIEW: 'Внешняя проверка преподавателем (записана владельцем)',
  HUMAN_EXAMINER_REVIEW: 'Внешняя проверка экзаменатором (записана владельцем)',
  SYNTHETIC_TEST_FIXTURE: 'Синтетическая тестовая фикстура',
};

export const VERDICT_LABEL: Record<string, string> = {
  CORRECT: 'Верно', ACCEPTABLE_VARIANT: 'Допустимый вариант', INCORRECT_CONFIRMED: 'Ошибка', AMBIGUOUS: 'Неоднозначно',
  ASR_UNCERTAIN: 'Распознавание неуверенно', UNSUPPORTED: 'Не поддерживается', PENDING_REVIEW: 'Ждёт проверки',
  ABSTAIN: 'AI воздержался', NOT_ASSESSED: 'Не оценивается',
};

export const AXIS_LABEL: Record<string, string> = {
  listening: 'Аудирование', reading: 'Чтение', spoken_interaction: 'Диалог', spoken_production: 'Монолог',
  writing: 'Письмо', pronunciation: 'Произношение', grammar: 'Грамматика', vocabulary: 'Лексика',
};

export const MODULE_LABEL: Record<string, string> = { core: 'Курс A1–B2', keg_b2: 'ΚΕΓ B2', pegp: 'ΠΕΓΠ', real_greek: 'Живой греческий', synthetic_fixture: 'Тестовые фикстуры' };

export const DIGITAL_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ждёт ASR-проверки', AUDIO_VERIFIED_DIGITAL: 'Цифровая проверка пройдена', NEEDS_REVIEW: 'Нужна проверка', BLOCKED: 'Заблокировано',
};

export const POLICY_RISKS: Array<{ id: string; text: string }> = [
  { id: 'no_teacher_review', text: 'Учебные материалы не проверены независимым преподавателем.' },
  { id: 'no_examiner_calibration', text: 'Экзаменационные формы не откалиброваны экзаменатором; баллы — учебные и предварительные.' },
  { id: 'synthetic_audio_unverified', text: 'Синтезированное аудио не проверено носителем языка; цифровая проверка ≠ естественность речи.' },
  { id: 'ai_is_not_human', text: 'AI-проверка (лингвистическая, по рубрике) не является проверкой человеком.' },
  { id: 'learner_disclosure', text: 'Ученикам будет показана маркировка «Цифровая проверка, без независимой экспертизы».' },
];

export const POLICY_STATEMENT = 'Владелец GreekOS осознанно разрешает выпуск отдельных материалов ученикам по цифровой политике проверки (структурный импорт, цифровой QA, решение владельца) без независимой экспертизы преподавателя или экзаменатора. Статусы HUMAN_VERIFIED и EXAMINER_CALIBRATED не присваиваются. Остаточный риск ошибок в ключах, рубриках, произношении и экзаменационной сложности принят.';

export function minutesLabel(seconds: number): string {
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

export function dateTimeRu(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ERROR_KIND_LABEL: Record<string, string> = {
  wrong_option: 'неверный вариант', wrong_order: 'неверный порядок', wrong_assignment: 'неверное соответствие', accent_orthography: 'ударение',
  final_sigma_orthography: 'форма сигмы (σ/ς)', typography_only: 'типографика',
};
export const ERROR_STATUS_LABEL: Record<string, string> = { open: 'открыта', resolved: 'исправлена', superseded: 'заменена', disputed: 'оспорена' };
export const ROUTE_KIND_LABEL: Record<string, string> = { foundations: 'основы чтения (с нуля)', provisional: 'предварительный по диагностике', verified: 'подтверждённый', manual: 'задан владельцем' };
export const SESSION_STATUS_LABEL: Record<string, string> = { ACTIVE: 'идёт', ENDED: 'завершён', ABANDONED: 'брошен' };
