/**
 * Lost spaces around numbers (an import artefact: «День7:», «Напишите80–110слов», «στις20:00», «комната2»).
 * A space is restored between a Cyrillic or Greek letter and a digit; Greek ordinal endings stay attached
 * («19ου», «28ης», «1ος»). Pure: used by the content revisions and when showing criteria.
 */
const CY = 'А-Яа-яЁё';
const GR = 'Α-Ωα-ωΆ-Ώά-ώϊϋΐΰ';
const GREEK_ORDINAL = '(?:ος|ου|ού|ης|ής|η|ή|ο|ό|ων|ών|α|ες|ους|οι|ός|ον)(?![Α-Ωα-ωά-ώ])';
export function restoreNumberSpacing(t: string): string {
  return t
    .replace(new RegExp(`([${CY}])(\\d)`, 'g'), '$1 $2')
    .replace(new RegExp(`(\\d)([${CY}])`, 'g'), '$1 $2')
    .replace(new RegExp(`([${GR}])(\\d)`, 'g'), '$1 $2')
    .replace(new RegExp(`(\\d)(?!${GREEK_ORDINAL})([${GR}])`, 'g'), '$1 $2');
}

/**
 * Lost spaces after punctuation in Russian text (an import artefact in U-A2-014/015: «другу,что», «дома,не в
 * парке», «Ела дома.Не»): a space after , ; : before a Cyrillic letter, and between a sentence-final dot and a
 * capital Cyrillic letter. Greek is never touched («ό,τι» keeps its comma). Pure; applied when showing text.
 */
export function restorePunctuationSpacing(t: string): string {
  return t
    .replace(new RegExp(`([,;:])(?=[${CY}])`, 'g'), '$1 ')
    // «дома,30 минут»: after a Cyrillic word only — a decimal «1,5» keeps its comma.
    .replace(new RegExp(`([${CY}])([,;])(?=\\d)`, 'g'), '$1$2 ')
    .replace(new RegExp(`([а-яё])\\.(?=[А-ЯЁ])`, 'g'), '$1. ');
}

/** What the learner reads: number and punctuation spacing restored (content is never rewritten by this). */
export function displaySpacing(t: string): string {
  return restorePunctuationSpacing(restoreNumberSpacing(t));
}
