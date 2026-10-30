# GreekOS

Платформа изучения новогреческого A1–B2 для 4–5 учеников с отдельным владельцем (owner_admin).
Next.js 16 (App Router, TypeScript) · Supabase (Auth, Postgres + RLS, Storage, Realtime) · Vercel.
Интерфейс на русском, учебный материал на греческом, дизайн — утверждённый прототип UX/UI v5.1
(+ контекстный разбор ошибок v5.2, AI Speaking v5.3).

> Академический статус корпуса: **NOT_READY_FOR_ACADEMIC_PUBLICATION**. Все 1843 задания и 87 уроков
> импортируются закрытыми (`CONTENT_GATED`). Ученик видит материал только после отдельного решения
> владельца о выпуске конкретного хеша. См. [docs/STATUS.md](docs/STATUS.md).

## Быстрый старт (локально)

Нужны Node ≥ 22.12, Docker, Python 3.12 (только для независимой проверки пакета).

```bash
npm ci
npx supabase start            # отдельный стек project_id=greekos на портах 55321–55329
cp .env.example .env.local    # подставьте значения, которые напечатал supabase start
set -a && . ./.env.local && set +a
npm run import:validate       # 22 886 проверок без записи в БД
npm run import                # одна транзакция; повтор идемпотентен
npx tsx scripts/create-owner.ts --email you@example.com --name "Имя"   # приглашение владельца
npm run dev                   # http://127.0.0.1:3210
```

Письма (приглашения, восстановление пароля) локально попадают в Mailpit: http://127.0.0.1:55324.

Локальные голос, распознавание и AI-собеседник (v6, без ключей и оплаты) — подробно в
[docs/LOCAL_AI_SETUP.md](docs/LOCAL_AI_SETUP.md):

```bash
npm run models:fetch     # модели в ~/greekos-models с проверкой SHA-256 (манифест local-services/models.manifest.json)
npm run local:speech     # синтез (Coqui VITS, MBROLA) + Whisper (sherpa-onnx) на 127.0.0.1:3312
npm run local:llm        # OpenAI-совместимый сервер Qwen3-4B (node-llama-cpp) на 127.0.0.1:3313
npm run voice:gateway    # потоковый голосовой шлюз на 127.0.0.1:3311
npm run audio -- cast    # каталог голосов + предложения кастинга (подтверждает владелец в админке)
```

Аудио курса без повторного синтеза: `npm run audio -- import-bundle --dir ../audio_bundle` загружает
сгенерированные файлы из комплекта (каждый сверяется с SHA-256 манифеста). Реальные уроки до выпуска —
через DEV-PREVIEW тестового аккаунта (только `APP_ENV=local`): Админ → DEV-PREVIEW или
`scripts/dev-preview.ts create-tester`. Локальные движки не дают права распространять звук ученикам
(`DEV_LOCAL_ONLY`), а локальная модель считается невалидированной для греческого.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` / `build` / `start` | разработка, production-сборка, запуск сборки |
| `npm run typecheck` / `lint` | TypeScript и ESLint |
| `npm test` | unit-тесты (фикстуры спецификации ADAPTIVE/FINALIZATION, оценивание, DTO по всем 1843 заданиям, аудио-QA) |
| `npm run test:integration` | RLS/Storage/RPC/идемпотентность на реальном локальном Postgres |
| `npm run test:e2e` | Playwright: путь ученика, Realtime в двух вкладках, 1440/768/390/320 px, axe, клавиатура, живой разговор с поддельным микрофоном (нужны шлюз и local:asr) |
| `npm run security:bundle` | после `build`: в браузерном бандле нет ключей, ответов и редакторских материалов |
| `npm run import:validate` / `import` | проверка и импорт канонического корпуса |
| `npm run owner:create` | создать/пригласить единственного владельца |
| `npm run audio -- validate\|cast\|plan\|render\|render-batch\|rescore\|export-bundle\|import-bundle\|inspect\|report\|benchmark` | кастинг голосов, цифровое производство 142 аудиозаданий, пересчёт вердиктов, перенос файлов между машинами, отчёты |
| `npm run models:fetch` / `local:speech` / `local:llm` | локальные модели (с проверкой хешей), сервис речи и языковая модель (разработка) |
| `npx tsx scripts/qa-batch.ts` | цифровой QA всего корпуса (отчёт JSON+MD с SHA-256 в `reports/v6/qa`) |
| `npx tsx scripts/export-corpus-snapshot.ts` | снимок корпуса из БД для unit-тестов, если исходной папки корпуса нет |
| `node scripts/capture-v6.mjs <learner> <owner>` | скриншоты и capture-видео ключевых сценариев с работающего приложения |
| `npm run local:asr` / `voice:gateway` | локальный Whisper и потоковый голосовой шлюз (разработка) |
| `npm run voice:bench` | замер задержек и ASR живого разговора через настоящий шлюз (синтетические клипы) |
| `npx tsx scripts/voice-reports.ts` | Markdown-отчёты v5.4 из измеренных JSON в `reports/v5.4` |

## Архитектура

- **Контент**: неизменяемые ревизии `content_revisions (kind, id, sha256)` + текущие таблицы
  (`items`, `units`, `exam_components`, `speaking_scenarios`, …). Смена хеша отзывает допуски и
  инвалидирует аудио. Таблицы контента недоступны через публичный API (нет грантов anon/authenticated).
- **Допуск**: `content_releases` на точный хеш, тип проверки (`OWNER_DIGITAL_POLICY` требует подписанной
  политики риска; `HUMAN_*` — ссылку и хеш доказательства), срок (ΠΕΓΠ — обязательно). Задание с
  аудио дополнительно требует выпущенного аудио, прошедшего цифровой QA.
- **Ученик**: все строки с `user_id` из проверенной сессии. RLS: ученик читает только свои строки при
  активном профиле; запись — только через серверные обработчики и транзакционную функцию
  `commit_learning_event` (идемпотентность, advisory-lock по ученику, проверка владельца строк).
- **Голос (v5.4)**: каталог голосов с полом из метаданных провайдера → роли кастинга → кастинг
  заданий (имена персонажей — только владелец). Живой разговор — отдельный WebSocket-процесс
  `voice-gateway/` (не Vercel): токен 60 с от `/api/speaking/stream-token`, адаптивный VAD
  (`src/lib/speaking/vad.ts`), ASR-адаптер (`src/lib/providers/streaming-asr.ts`), тот же диалоговый
  сервис и идемпотентность, что у REST, TTS по предложениям, перебивание с записью услышанного,
  метрики `speaking_turn_metrics`. Без шлюза — пошаговый режим.
- **Оценивание**: ключ задания с его нормализацией (ударения сохраняются) → незнакомый ответ на
  проверку без штрафа → открытые ответы по критериям через Claude со схемной валидацией; цитаты
  обязаны дословно входить в ответ, иначе ABSTAIN. Владелец может проверить вручную (помечается
  «не независимый преподаватель»), ученик может оспорить.
- **Освоение**: журнал `mastery_events` → производное состояние; «сохранено» только после
  самостоятельных D7 и D28 по локальному календарю ученика. Помощь, предпросмотр, диагностика,
  неуверенный ASR и письменный ответ на устное задание не продвигают освоение.
- **Realtime**: подтверждённые события `learner_events` → Supabase Realtime (RLS) → экраны
  перезапрашивают серверный снимок; после потери сети — повторная синхронизация без дублей.
- **AI Speaking**: сценарии корпуса как граф; Claude классифицирует переход и (в свободных режимах)
  пишет реплику с меткой AI_DRAFT; ASR → подтверждение транскрипта → ход; TTS el-GR с кешем;
  подсказки не меняют состояние сцены; итог только по подтверждённым репликам.
- **Аудио**: план → синтез по сегментам → измерения по реальным байтам → технический QA →
  ASR round-trip → `AUDIO_VERIFIED_DIGITAL` (никогда `HUMAN_*`) → права провайдера → выпуск.

Подробнее: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), [docs/STATUS.md](docs/STATUS.md).
