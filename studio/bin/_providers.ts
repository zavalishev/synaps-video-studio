// Провайдеры платных шагов студии — каждый пользователь подключает своих в .env (образец .env.example):
//   VOICE_PROVIDER = openai | elevenlabs | command | none   — studio voice   (_tts.ts)
//   IMAGE_PROVIDER = openai | gemini | codex | command | none — studio image (_img.ts; codex — по подписке ChatGPT)
//   ASR_PROVIDER   = auto | whisper | openai | none         — тайминги слов  (_asr.ts)
// command — любая своя программа по шаблону команды (Kimi-Audio, Silero, Piper, XTTS, ComfyUI…).
// Что настроено и что директор может сделать — `studio doctor`. Ключи никогда не печатаются.
// Paid-step providers. Configure in .env; check with `studio doctor`.
export { ProviderError, ProviderNotConfigured, redact, SECRET_VARS, type Deps } from "./_http";
export { charsToWords, OPENAI_VOICES, tts, voiceConfig, type TimedWord, type TtsRequest, type TtsResult, type VoiceConfig } from "./_tts";
export { image, imageConfig, removeBackground, type ImageConfig, type ImageOptions, type ImageResult } from "./_img";
export { asrPlan, retime, transcribeOpenAI, whisperLocal, type AsrStep } from "./_asr";
