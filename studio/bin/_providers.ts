// Провайдеры платных шагов студии: озвучка (studio voice) и картинки (studio image).
// Здесь только контракт: каждый пользователь подключает своих провайдеров (свои ключи).
// Пока провайдер не настроен, вызов падает с понятной ошибкой — остальная студия
// (сцены, рендер, проверки, звук из каталога, Blender) работает без него.

export class ProviderNotConfigured extends Error {
  constructor(what: string) {
    super(`${what}: провайдер не настроен — подключите свой (см. README, раздел «Провайдеры»)`);
    this.name = "ProviderNotConfigured";
  }
}

export type TtsRequest = { model: string; voice: string; input: string; instructions?: string; response_format?: string };
// Озвучка одной реплики → аудио (mp3).
export const tts = (_req: TtsRequest): Buffer => {
  throw new ProviderNotConfigured("озвучка (TTS)");
};

export type ImageOptions = { size?: string; quality?: string; background?: string };
// Модель картинок входит в ключ кэша .cache/studio-img: другая модель — другие картинки.
export const IMAGE_MODEL = process.env.STUDIO_IMAGE_MODEL ?? "unconfigured";
// Картинка по промпту → PNG; refs — уменьшенные JPEG-референсы (лист персонажа, стиль).
export const image = async (_prompt: string, _opts: ImageOptions = {}, _refs: Buffer[] = []): Promise<Buffer> => {
  throw new ProviderNotConfigured("картинки");
};
