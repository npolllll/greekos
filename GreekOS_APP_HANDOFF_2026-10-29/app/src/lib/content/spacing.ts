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
