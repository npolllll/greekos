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
  get appEnv(): 'local' | 'preview' | 'production' | 'test' {
    const v = opt('APP_ENV') ?? (process.env.VERCEL_ENV === 'production' ? 'production' : process.env.VERCEL_ENV === 'preview' ? 'preview' : 'local');
    return v as 'local' | 'preview' | 'production' | 'test';
  },
  /** Synthetic mock providers are refused in production and must be explicitly enabled elsewhere. */
  get allowSyntheticProviders() { return opt('ALLOW_SYNTHETIC_PROVIDERS') === '1' && this.appEnv !== 'production'; },

  get anthropicKey() { return opt('ANTHROPIC_API_KEY'); },
  get llmModelDialogue() { return opt('LLM_MODEL_DIALOGUE') ?? 'claude-opus-5-5'; },
  get llmModelAssessor() { return opt('LLM_MODEL_ASSESSOR') ?? 'claude-opus-5-5'; },

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
  get googleTtsVoices() { return (opt('GOOGLE_TTS_VOICES') ?? 'el-GR-Wavenet-A,el-GR-Standard-B').split(',').map((s) => s.trim()); },

  /** Cost guards (USD). Exceeding them blocks provider calls; they are estimates, not invoices. */
  get dailyUserBudgetUsd() { return Number(opt('BUDGET_DAILY_USD_PER_USER') ?? '1.5'); },
  get monthlyBudgetUsd() { return Number(opt('BUDGET_MONTHLY_USD') ?? '40'); },
  get audioRunBudgetUsd() { return Number(opt('AUDIO_RUN_BUDGET_USD') ?? '5'); },
  get cronSecret() { return opt('CRON_SECRET'); },
};
