import { buildItemDTO, assertNoLeak, type ItemDTO } from './dto.ts';
import { loadTextObjects, playableAudio, devPreviewAudio, releaseMap, itemAccess, PUBLIC_VIEWER, type ItemRow, type ItemAccess, type Viewer } from './repo.ts';

export interface DeliveredItem {
  dto: ItemDTO;
  access: ItemAccess;
}

/**
 * Server-side assembly of learner/candidate DTOs: release + audio status, whitelisted stimulus
 * text, and a final leak assertion. Callers decide whether gated items are shown (preview only).
 */
export async function deliverItems(rows: ItemRow[], opts: { examMode?: boolean; ownerPreview?: boolean; viewer?: Viewer } = {}): Promise<DeliveredItem[]> {
  const viewer = opts.viewer ?? PUBLIC_VIEWER;
  const audioIds = [...new Set(rows.flatMap((r) => r.audio_job_ids))];
  const [rel, audio, texts, devAudio] = await Promise.all([
    releaseMap('item', rows.map((r) => ({ id: r.item_id, hash: r.current_hash })), viewer),
    playableAudio([...new Set(rows.flatMap((r) => r.audio_job_ids))], viewer),
    loadTextObjects([...new Set(rows.map((r) => (r.envelope.stimulus as { text_id?: string } | null)?.text_id).filter((x): x is string => typeof x === 'string'))]),
    opts.ownerPreview && !opts.examMode ? devPreviewAudio(audioIds) : Promise.resolve(new Map()),
  ]);
  const out: DeliveredItem[] = [];
  for (const r of rows) {
    const access = itemAccess(r, rel, audio);
    const textId = (r.envelope.stimulus as { text_id?: string } | null)?.text_id;
    const firstAudio = r.audio_job_ids.map((a) => audio.get(a)).find(Boolean);
    // Access is always computed from learner-grade audio; dev-only audio only lets the owner listen.
    const devFirst = !firstAudio ? r.audio_job_ids.map((a) => devAudio.get(a)).find(Boolean) : undefined;
    const learnerSpeech = r.requires_audio && r.audio_job_ids.length === 0;
    let dto: ItemDTO;
    try {
      dto = buildItemDTO({
        item: r.envelope,
        contentHash: r.current_hash,
        textObject: textId ? texts.get(textId) ?? null : null,
        audio: r.requires_audio ? (access.audioReady && firstAudio ? { status: 'available', asset_id: firstAudio.asset_id, synthetic: true, ...(firstAudio.dev_only ? { dev_only: true as const, qa: firstAudio.qa } : {}) } : devFirst ? { status: 'available', asset_id: devFirst.asset_id, synthetic: true, dev_only: true, qa: devFirst.qa } : { status: 'unavailable', reason: 'AUDIO_PENDING' }) : null,
        examMode: opts.examMode,
      });
      if (learnerSpeech) dto = { ...dto, requires_audio: false, audio: null, spoken_task: true };
    } catch {
      continue; // unsupported type: fails closed (never rendered with an invented score)
    }
    assertNoLeak(dto);
    out.push({ dto, access });
  }
  return out;
}
