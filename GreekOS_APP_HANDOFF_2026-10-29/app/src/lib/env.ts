/** Server-side configuration. Secrets never leave the server; NEXT_PUBLIC_* are the only browser values. */
function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function req(name: string): string {
  const v = opt(name);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get supabaseUrl() { return req('NEXT_PUBLIC_SUPABASE_URL'); },
  get supabaseAnonKey() { return req('NEXT_PUBLIC_SUPABASE_ANON_KEY'); },
  get serviceRoleKey() { return req('SUPABASE_SERVICE_ROLE_KEY'); },
  get appUrl() { return opt('APP_URL') ?? 'http://127.0.0.1:3210'; },
  /** Salt for hashing IP addresses and e-mails in the registration rate limit (never stored in clear). */
  get registrationSalt() { return opt('REGISTRATION_SALT') ?? this.serviceRoleKey.slice(-24); },
  get appEnv(): 'local' | 'preview' | 'production' | 'test' {
    const v = opt('APP_ENV') ?? (process.env.VERCEL_ENV === 'production' ? 'production' : process.env.VERCEL_ENV === 'preview' ? 'preview' : 'local');
    return v as 'local' | 'preview' | 'production' | 'test';
  },
  /** Synthetic mock providers are refused in production and must be explicitly enabled elsewhere. */
  get allowSyntheticProviders() { return opt('ALLOW_SYNTHETIC_PROVIDERS') === '1' && this.appEnv !== 'production'; },

  get anthropicKey() { return opt('ANTHROPIC_API_KEY'); },
  /**
   * LLM provider: anthropic (Claude, needs a key) | openai_compatible (any /v1/chat/completions
   * endpoint: the GreekOS local server, llama.cpp, LM Studio, Ollama, vLLM, cloud) | none.
   * Default: anthropic when a key is set, otherwise openai_compatible when LLM_BASE_URL is set.
   */
  get llmProvider(): 'anthropic' | 'openai_compatible' | 'none' {
    const v = opt('LLM_PROVIDER');
    if (v === 'anthropic' || v === 'openai_compatible' || v === 'none') return v;
    return this.anthropicKey ? 'anthropic' : opt('LLM_BASE_URL') ? 'openai_compatible' : 'none';
  },
  get llmBaseUrl() { return opt('LLM_BASE_URL'); },
  get llmApiKey() { return opt('LLM_API_KEY'); },
  get llmCompatModel() { return opt('LLM_MODEL') ?? 'local-model'; },
  /** Per-call budget for a speaking turn / help request. A CPU-only local model may need more than a cloud one. */
  get llmTurnTimeoutMs() { return Number(opt('LLM_TURN_TIMEOUT_MS') ?? 25_000); },
  // Budget (5–10 €/month for everything): the most economical current model for dialogue and assessment.
  get llmModelDialogue() { return opt('LLM_MODEL_DIALOGUE') ?? 'claude-haiku-5-5'; },
  get llmModelAssessor() { return opt('LLM_MODEL_ASSESSOR') ?? 'claude-haiku-5-5'; },

  get asrProvider() { return (opt('ASR_PROVIDER') ?? 'none') as 'openai' | 'azure' | 'local' | 'mock' | 'none'; },
  get ttsProvider() { return (opt('TTS_PROVIDER') ?? 'none') as 'openai' | 'azure' | 'google' | 'local' | 'mock' | 'none'; },
  /** Local engines (macOS say + local Whisper) are development-only and refused in production. */
  get localEnginesAllowed() { return this.appEnv === 'local' || this.appEnv === 'test'; },
  /** Local dev only: let learners play DEV_LOCAL_ONLY renders to exercise listening flows end-to-end. */
  get allowLocalVoicePlayback() { return opt('ALLOW_LOCAL_VOICE_PLAYBACK_FOR_DEV') === '1' && this.localEnginesAllowed; },
  get voiceGatewaySecret() { return opt('VOICE_GATEWAY_SECRET'); },
  get voiceGatewayPublicUrl() { return opt('NEXT_PUBLIC_VOICE_GATEWAY_URL'); },
  get openaiKey() { return opt('OPENAI_API_KEY'); },
  get openaiAsrModel() { return opt('OPENAI_ASR_MODEL') ?? 'gpt-4o-transcribe'; },
  get openaiTtsModel() { return opt('OPENAI_TTS_MODEL') ?? 'gpt-4o-mini-tts'; },
  get openaiTtsVoices() { return (opt('OPENAI_TTS_VOICES') ?? 'coral,onyx,sage,ash').split(',').map((s) => s.trim()); },
  get azureSpeechKey() { return opt('AZURE_SPEECH_KEY'); },
  get azureSpeechRegion() { return opt('AZURE_SPEECH_REGION'); },
  get azureTtsVoices() { return (opt('AZURE_TTS_VOICES') ?? 'el-GR-AthinaNeural,el-GR-NestorasNeural').split(',').map((s) => s.trim()); },
  get googleTtsKey() { return opt('GOOGLE_TTS_API_KEY'); },
  /** Provider endpoints (overridable for a regional/private endpoint, or a contract-test server). */
  get azureTtsBase() { return (opt('AZURE_SPEECH_TTS_URL') ?? `https://${this.azureSpeechRegion}.tts.speech.microsoft.com`).replace(/\/$/, ''); },
  get azureSttBase() { return (opt('AZURE_SPEECH_STT_URL') ?? `https://${this.azureSpeechRegion}.stt.speech.microsoft.com`).replace(/\/$/, ''); },
  get googleTtsBase() { return (opt('GOOGLE_TTS_URL') ?? 'https://texttospeech.googleapis.com').replace(/\/$/, ''); },
  get openaiBase() { return (opt('OPENAI_BASE_URL') ?? 'https://api.openai.com').replace(/\/$/, ''); },
  get googleTtsVoices() { return (opt('GOOGLE_TTS_VOICES') ?? 'el-GR-Wavenet-A,el-GR-Standard-B').split(',').map((s) => s.trim()); },

  /**
   * Spending ceiling (EUR, all services together). Paid API calls are blocked once this month's spend
   * reaches (BUDGET_MONTHLY_EUR_MAX − BUDGET_FIXED_EUR) × BUDGET_SAFETY_RATIO. USD list prices are
   * converted with a conservative rate (1 USD = 1 EUR) and a tax multiplier (Greek VAT 24 %).
   */
  get budgetMonthlyEurMax() { return Number(opt('BUDGET_MONTHLY_EUR_MAX') ?? '10'); },
  get budgetMonthlyEurTarget() { return Number(opt('BUDGET_MONTHLY_EUR_TARGET') ?? '5'); },
  /** Monthly fixed infrastructure outside the per-call ledger (voice gateway machine, domain…). */
  get budgetFixedEur() { return Number(opt('BUDGET_FIXED_EUR') ?? '5.5'); },
  get budgetSafetyRatio() { return Math.min(1, Math.max(0, Number(opt('BUDGET_SAFETY_RATIO') ?? '0.8'))); },
  get budgetDailyEurPerUser() { return Number(opt('BUDGET_DAILY_EUR_PER_USER') ?? '0.5'); },
  get budgetUsdToEur() { return Number(opt('BUDGET_USD_TO_EUR') ?? '1'); },
  get budgetTaxMultiplier() { return Number(opt('BUDGET_TAX_MULTIPLIER') ?? '1.24'); },
  /** Azure Speech pricing tier: F0 (free, hard quota, no charges) or S0 (pay per use). */
  get azureSpeechTier() { return (opt('AZURE_SPEECH_TIER') ?? 'F0').toUpperCase() === 'S0' ? 'S0' as const : 'F0' as const; },
  get azureTtsUsdPerMillionChars() { return Number(opt('AZURE_TTS_USD_PER_MILLION_CHARS') ?? '16'); },
  get azureSttUsdPerHour() { return Number(opt('AZURE_STT_USD_PER_HOUR') ?? '1'); },
  get audioRunBudgetUsd() { return Number(opt('AUDIO_RUN_BUDGET_USD') ?? '5'); },
  get cronSecret() { return opt('CRON_SECRET'); },
};
