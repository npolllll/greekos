import { z } from 'zod';
import { route } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { importJobAudio } from '@/lib/audio/import';

export const maxDuration = 300;

const Meta = z.object({
  audio_id: z.string().min(3).max(60),
  provider: z.string().trim().min(2).max(120),
  voices: z.record(z.string().max(80), z.string().trim().max(120)),
  presentations: z.record(z.string().max(80), z.enum(['female', 'male'])).optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

/** Owner uploads a finished WAV for one job (studio / voice actor / external TTS); it enters digital QA. */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'NO_FILE', 'Прикрепите WAV-файл.');
  if (file.size > 60 * 1024 * 1024) throw new HttpError(413, 'TOO_LARGE', 'Файл больше 60 МБ.');
  const meta = Meta.parse(JSON.parse(String(form.get('meta') ?? '{}')));
  const r = await importJobAudio(meta.audio_id, new Uint8Array(await file.arrayBuffer()), meta, owner.userId);
  if (!r.ok) throw new HttpError(r.error === 'NOT_FOUND' ? 404 : r.error === 'STALE' ? 409 : 422, r.error, r.message);
  await audit(owner.userId, 'audio.imported', { id: meta.audio_id }, { asset_id: r.asset_id, producer: meta.provider, digital_status: r.digital_status });
  return r;
});
