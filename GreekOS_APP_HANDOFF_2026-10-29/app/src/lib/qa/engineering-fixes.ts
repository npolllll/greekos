/**
 * Content defects found by digital QA that have one clear fix and need no linguistic judgement beyond
 * the task's own design: the instruction gave the answer away, so the item tested copying. Each fix is
 * a new revision through the normal patch path (history, release revocation, re-run QA), recorded with
 * the system actor below — never as an owner's or reviewer's decision; admission stays with the owner.
 * Idempotent: a fix applies only while the item still has the exact text it was written against.
 */
import { adminClient } from '../supabase/admin.ts';
import { patchItem } from './release.ts';

export const ENGINEERING_ACTOR = 'digital-qa-engineering/1.0';

interface ItemFix { item_id: string; before_prompt: string; changes: { prompt?: string; accepted_alternatives?: string[] }; reason: string }

export const ITEM_FIXES: ItemFix[] = [
  {
    item_id: 'U-A1-001-I02', before_prompt: 'Заполните только форму είμαι: Εγώ ___ φοιτητής.',
    changes: { prompt: 'Вставьте нужную форму глагола «быть» (είμαι / είσαι / είναι): Εγώ ___ φοιτητής.' },
    reason: 'Ответ был назван в инструкции («форму είμαι»): задание проверяло копирование. Теперь выбор лица из трёх форм.',
  },
  {
    item_id: 'U-A1-002-I05', before_prompt: 'Поставьте φίλος: Ο ___ μου περιμένει.',
    changes: { prompt: 'Вставьте слово в нужной форме: Ο ___ μου περιμένει. (φίλος)' },
    reason: 'Инструкция давала готовую форму ответа; теперь ученик решает, нужна ли другая форма (лемма — подсказкой в скобках).',
  },
  {
    item_id: 'U-A1-007-I02', before_prompt: 'Соедините Α Β Ρ Η с α β ρ η. Запишите строчные в порядке прописных.',
    changes: { prompt: 'Соедините Α Β Ρ Η со строчными η α ρ β. Запишите строчные в порядке прописных.' },
    reason: 'Строчные буквы стояли в том же порядке, что и ответ; теперь они перемешаны.',
  },
  {
    item_id: 'U-A1-008-I03', before_prompt: 'Распределите η, ω, ου по [i], [o], [u]. Ответ в исходном порядке.',
    changes: { prompt: 'Распределите η, ω, ου по звукам [u], [i], [o]. Запишите звук каждой буквы в исходном порядке букв.' },
    reason: 'Звуки были перечислены в порядке ответа; теперь порядок другой.',
  },
  {
    item_id: 'U-A1-009-I04', before_prompt: 'Назовите причину, используя γιατί: Μένω σπίτι ___ είμαι άρρωστος.',
    changes: { prompt: 'Соедините части союзом со значением «потому что»: Μένω σπίτι ___ είμαι άρρωστος.', accepted_alternatives: ['επειδή'] },
    reason: 'Инструкция называла ответ («используя γιατί»); теперь дано значение союза, и «επειδή» тоже принимается как верный ответ.',
  },
];

export async function applyEngineeringFixes(): Promise<Array<{ item_id: string; status: 'applied' | 'already' | 'changed_since'; new_hash?: string }>> {
  const db = adminClient();
  const out: Array<{ item_id: string; status: 'applied' | 'already' | 'changed_since'; new_hash?: string }> = [];
  for (const f of ITEM_FIXES) {
    const { data: it } = await db.from('items').select('item_id, envelope, current_hash').eq('item_id', f.item_id).maybeSingle();
    const prompt = String((it?.envelope as { prompt?: string } | undefined)?.prompt ?? '');
    if (!it) continue;
    if (prompt === f.changes.prompt) { out.push({ item_id: f.item_id, status: 'already' }); continue; }
    if (prompt !== f.before_prompt) { out.push({ item_id: f.item_id, status: 'changed_since' }); continue; }
    const { data: issue } = await db.from('qa_issues').select('id').eq('content_id', f.item_id).eq('check_id', 'keys.key_in_prompt').eq('status', 'open').limit(1).maybeSingle();
    const r = await patchItem({ system: ENGINEERING_ACTOR }, { item_id: f.item_id, base_hash: it.current_hash, changes: f.changes, issue_id: issue?.id, reason: `Цифровой QA: ${f.reason}` });
    out.push({ item_id: f.item_id, status: 'applied', new_hash: r.new_hash });
  }
  return out;
}
