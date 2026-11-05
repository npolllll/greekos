/**
 * Content QA per lesson → reports/<out>/lesson-qa.json + README.md (one row per lesson, then details).
 *   npx tsx --conditions=react-server scripts/lesson-qa-report.ts [--out reports/v8/lesson-qa]
 * Reads the latest digital QA results on each object's current hash; run `scripts/qa-batch.ts` first
 * after content changes. Automatic checks only — never a teacher's or native speaker's review.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLessonQa, lessonQaMarkdown } from '../src/lib/qa/lesson-report.ts';

const i = process.argv.indexOf('--out');
const out = i > 0 ? process.argv[i + 1] : 'reports/v8/lesson-qa';
const at = new Date().toISOString();
const rows = await buildLessonQa();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'lesson-qa.json'), JSON.stringify({ generated_at: at, kind: 'DIGITAL_QA_NOT_HUMAN_REVIEW', lessons: rows }, null, 1));
writeFileSync(join(out, 'README.md'), lessonQaMarkdown(rows, at.slice(0, 16).replace('T', ' ') + ' UTC'));
const by = (s: string) => rows.filter((r) => r.summary === s).length;
console.log(JSON.stringify({ lessons: rows.length, ready_for_owner: by('READY_FOR_OWNER'), needs_fix: by('NEEDS_FIX'), not_checked_current: by('NOT_CHECKED_CURRENT'), out }));
process.exit(0);
