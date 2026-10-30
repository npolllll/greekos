# База данных GreekOS — что лежит в этой папке и как восстановить

> **v6 (30.10.2026):** миграций 12 (+3: цифровой QA, решения о выпуске, DEV-PREVIEW, кеш озвучки фраз,
> правки ревизиями). Данные корпуса не менялись — `02_content_data.sql` подходит без изменений.
> Аудио теперь в комплекте: `../audio_bundle/` (WAV + `AUDIO_BUNDLE_MANIFEST.json` с SHA-256), загрузка —
> `npm run audio -- import-bundle --dir ../audio_bundle`. Проверка «с нуля» на отдельном стеке:
> `../verification/2026-10-30_v6/clean_stack/`. Всё сразу — `app/scripts/setup-local.sh`.

| Файл | Что это |
|---|---|
| `../app/supabase/migrations/*.sql` | **Источник истины схемы** (9 миграций, применяются по порядку; 3 новые — v5.4: голоса и кастинг, потоковый разговор, лимит прослушиваний экзамена) |
| `01_schema_full.sql` | Полный дамп схемы **чистой** БД после всех 9 миграций (`supabase db dump --local`) — справочно, для diff/ревью |
| `02_content_data.sql` | Данные импортированного корпуса, обычный SQL (`pg_dump --data-only`, 19 таблиц) |
| `02_content_data.dump` | Те же данные в custom-формате для `pg_restore` (сжато) |
| `SCHEMA_REFERENCE.md` | Сгенерированный из чистой БД справочник (61 таблица): колонки, CHECK/FK, политики RLS, функции, гранты, бакеты, Realtime |
| `import_report/import_report.json` | Отчёт импортёра для этого снимка: входные SHA-256, 22 886 проверок, счётчики |

## Содержимое снимка (чистый импорт, без учеников и без выпусков)

| Таблица | Строк | Таблица | Строк |
|---|---|---|---|
| content_revisions | 5275 | items | 1843 |
| units | 87 | competencies | 167 (96 основных + 71 внешних) |
| source_claims | 2676 | rubrics | 91 |
| content_objects | 172 | audio_jobs | 142 |
| speaking_scenarios | 48 (44 SC + 4 RG-S) | exam_forms / exam_components | 3 / 15 |
| rg_expressions | 12 | pegp_packets | 8 |
| content_singletons | 11 | item_competencies / item_sources / item_audio | 5243 / 3254 / 226 |
| import_runs | 1 | content_releases | **0** (ничего не выпущено) |
| cast_roles | 6 (создаются миграцией, без голосов) | voice_catalog / audio_job_casting / audio_assets | **0** — заполняются на месте (`npm run audio -- cast`, генерация) |

Учетных записей и данных учеников в дампе нет: владелец создаётся заново скриптом
`npm run owner:create`, ученики приглашаются из админки.

**Аудиофайлы в пакет не входят.** 65 файлов, сгенерированных у разработчика, озвучены системным
голосом macOS, лицензия которого не разрешает передавать звук третьим лицам (`DEV_LOCAL_ONLY`).
Их метаданные (хеши, длительности, QA, таймкоды) — в `app/reports/v5.4/AUDIO_RENDER_REPORT.json`;
сами файлы воспроизводимо генерируются на месте (`npm run audio -- render-batch`) — локально на Mac
или облачным TTS с правами на распространение.

## Проверка восстановления (повторена 29.10.2026 на отдельном временном стеке)

Отдельный временный стек Supabase (`project_id=greekos-verify`, порты 556xx) → все 9 миграций с нуля →
импорт ×2 (22 886 проверок; второй прогон 0 вставок) → интеграционные тесты 32/32 (три прогона подряд) →
сброс → один импорт → дампы → сброс → восстановление из `02_content_data.sql` и, отдельно, из
`02_content_data.dump` → отпечатки (md5 полного содержимого всех 19 таблиц, `fingerprint_*.txt`)
**совпали** → повторный импорт поверх восстановленной БД: **0 вставок, всё unchanged** →
интеграционные тесты **32/32** на восстановленной БД. Логи: `../verification/2026-10-29_v5.4/clean_stack/`.

## Способы развернуть БД

**A. Рекомендуемый — миграции + импорт из исходного пакета** (воспроизводимо, с проверкой хешей):
```bash
cd app
npx supabase start                         # локально; для облака: supabase link + supabase db push
npm run import:validate && npm run import  # CORPUS_ROOT указывает на распакованный GreekOS_CLAUDE_UPLOAD_READY
```

**B. Миграции + этот снимок данных** (если исходного пакета под рукой нет):
```bash
cd app && npx supabase start               # или db push в облако
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../database/02_content_data.sql
# или: pg_restore -d "$DATABASE_URL" --data-only --no-owner --exit-on-error ../database/02_content_data.dump
```
Восстанавливайте только в пустую БД после миграций (иначе конфликты ключей).

**C. Облако Supabase:** `npx supabase link --project-ref <ref> && npx supabase db push`, затем A или B с
`DATABASE_URL` = прямое подключение (Project Settings → Database → URI). Подробно — `app/docs/DEPLOYMENT.md`.

## Модель безопасности (кратко)

- Контент, ключи ответов, рубрики, допуски, журнал аудита — **без грантов** для `anon`/`authenticated`.
- Таблицы ученика — RLS «только свои строки при активном профиле», только SELECT.
- Любая запись учебных фактов — `public.commit_learning_event(jsonb)` (EXECUTE только `service_role`):
  транзакция, advisory-lock по ученику, идемпотентность по `(user_id, key)`, проверка, что все строки
  пакета принадлежат одному ученику.
- `content_revisions` и `admin_audit_log` неизменяемы (триггер запрещает UPDATE/DELETE).
- `audio_assets`: синтетический тестовый транспорт (`provider='mock'`) не может получить статус
  проверенного аудио (CHECK); `RELEASE_ELIGIBLE` только при утверждённом кастинге, записанных правах
  провайдера и цифровой проверке (CHECK); права `DEV_LOCAL_ONLY` выпуску не подлежат.
- v5.4: `voice_catalog`, `cast_roles`, `audio_job_casting`, `audio_job_render_status` — только сервер;
  `speaking_turn_metrics` — ученик видит только свои строки; `exam_attempts.audio_plays` — счёт
  прослушиваний экзаменационных записей ведёт сервер.
