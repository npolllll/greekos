/**
 * Client voice UI state machine (AI_SPEAKING v5.3 + SPEAKING_ENGINE_CONTRACT). Every transition
 * not listed is rejected; there is no "spinning forever" state.
 */
export type VoiceState =
  | 'idle' | 'requesting_microphone' | 'permission_denied' | 'connecting' | 'ready' | 'listening'
  | 'transcribing' | 'confirming' | 'agent_responding' | 'agent_speaking' | 'low_confidence'
  | 'paused' | 'network_lost' | 'session_recovered' | 'ending' | 'ended' | 'failed';

export const TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  idle: ['requesting_microphone', 'connecting', 'ending'],
  requesting_microphone: ['connecting', 'permission_denied', 'failed'],
  permission_denied: ['connecting', 'ending'],
  connecting: ['ready', 'failed', 'network_lost'],
  ready: ['listening', 'agent_responding', 'paused', 'ending', 'network_lost'],
  listening: ['transcribing', 'ready', 'paused', 'ending', 'network_lost'],
  transcribing: ['confirming', 'low_confidence', 'agent_responding', 'network_lost', 'failed', 'ready'],
  confirming: ['agent_responding', 'listening', 'ready', 'ending'],
  low_confidence: ['listening', 'confirming', 'ready', 'ending'],
  agent_responding: ['agent_speaking', 'ready', 'network_lost', 'failed', 'ending'],
  agent_speaking: ['ready', 'listening', 'paused', 'ending'],
  paused: ['ready', 'connecting', 'ending'],
  network_lost: ['session_recovered', 'connecting', 'ending', 'failed'],
  session_recovered: ['ready', 'agent_responding'],
  ending: ['ended', 'failed'],
  ended: [],
  failed: ['connecting', 'ending'],
};

export function canTransition(from: VoiceState, to: VoiceState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextState(from: VoiceState, to: VoiceState): VoiceState {
  if (!canTransition(from, to)) throw new Error(`illegal voice transition ${from} → ${to}`);
  return to;
}

export const STATE_LABEL_RU: Partial<Record<VoiceState, string>> = {
  idle: 'Готово к началу',
  requesting_microphone: 'Запрашиваю микрофон…',
  permission_denied: 'Нет доступа к микрофону',
  connecting: 'Подключаюсь…',
  ready: 'Ваша очередь',
  listening: 'Слушаю',
  transcribing: 'Распознаю…',
  confirming: 'Проверьте распознанный текст',
  low_confidence: 'Не уверен, что расслышал',
  agent_responding: 'Думаю…',
  agent_speaking: 'Говорю',
  paused: 'Пауза',
  network_lost: 'Соединение прервалось',
  session_recovered: 'Соединение восстановлено',
  ending: 'Сохраняю…',
  ended: 'Разговор сохранён',
  failed: 'Ошибка — можно попробовать снова',
};

/** Barge-in: interrupting the agent cancels playback and marks the segment as not fully heard. */
export function bargeIn(state: VoiceState): { next: VoiceState; playbackCompleted: false } | null {
  if (state !== 'agent_speaking') return null;
  return { next: 'listening', playbackCompleted: false };
}

export type SpeakingMode = 'a0_guided' | 'course' | 'roleplay' | 'free_talk' | 'tutor_help' | 'b2_mock' | 'real_greek';

export const MODE_LABEL_RU: Record<SpeakingMode, string> = {
  a0_guided: 'Говорю с нуля',
  course: 'Тренировка урока',
  roleplay: 'Жизненная ситуация',
  free_talk: 'Свободный разговор',
  tutor_help: 'Разбор трудности',
  b2_mock: 'Экзамен B2 (учебная симуляция)',
  real_greek: 'Живой греческий',
};

/** Modes that reproduce authored scenario lines verbatim (LLM may only classify transitions). */
export const AUTHORED_LINE_MODES: SpeakingMode[] = ['a0_guided', 'course', 'b2_mock'];
export const HINTS_ALLOWED = (mode: SpeakingMode) => mode !== 'b2_mock';
