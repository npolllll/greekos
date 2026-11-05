# Развёртывание: Supabase + Vercel + Fly.io

Рабочая система — три сервиса:

| Часть | Где | Зачем |
|---|---|---|
| База, вход, письма, хранилище аудио | **Supabase Cloud**, регион ЕС (Франкфурт) | PostgreSQL с RLS, Auth, Storage; письма — через ваш SMTP (Resend) |
| Веб-приложение | **Vercel** | страницы, API, ежедневный cron хранения данных |
| Голосовой шлюз живого разговора | **Fly.io**, регион `fra`, 1 постоянная машина 512 МБ | долгое WebSocket-соединение (микрофон ↔ голос), которое функция Vercel держать не может |
| Модель разговора и оценки | Anthropic API | Claude |
| Распознавание и голоса | Azure Speech, `westeurope` | el-GR ASR и нейронные голоса |

**Быстрый путь — один сценарий.** Создайте проект Supabase (регион ЕС), аккаунты Vercel, Fly.io и
Resend (с подтверждённым доменом отправителя), ключи Anthropic и Azure Speech, и выполните в папке
приложения:

```bash
bash scripts/deploy-cloud.sh
```

Проверка без изменений (все секреты в выводе замаскированы):

```bash
DRY_RUN=1 bash scripts/deploy-cloud.sh
```

Сценарий (10 шагов) применяет миграции; настраивает вход и письма Supabase (`supabase config push`:
адрес сайта и перенаправления, запрет прямой регистрации, пароль ≥ 10, шаблоны писем, SMTP);
загружает корпус; создаёт владельца; проводит цифровой QA с записанными исправлениями и
методическими правками (`npm run qa:content-revisions`); синхронизирует
голоса Azure, предлагает кастинг и генерирует аудио в пределах `AUDIO_RUN_BUDGET_USD`; разворачивает
голосовой шлюз на Fly.io; задаёт переменные Vercel (включая `NEXT_PUBLIC_VOICE_GATEWAY_URL`) и
развёртывает приложение; проверяет `/api/health`, `/health` шлюза и проводит короткий живой разговор
через шлюз временным тестовым аккаунтом. Повторный запуск пропускает сделанное. Ответы хранятся только
на вашем компьютере (`.deploy/cloud.env`, права 600, вне git). Ручных настроек в панели Supabase
больше нет. Ниже — те же шаги вручную.

**Почта.** Resend отправляет письма только с подтверждённого домена (адрес `onboarding@resend.dev`
доходит лишь до владельца аккаунта Resend — ученикам он не подойдёт). Подтвердите домен в Resend
(Domains → Add → DNS-записи SPF/DKIM у регистратора) и укажите отправителя на нём
(`SMTP_SENDER=no-reply@ваш-домен`). Подойдёт и любой другой SMTP (Postmark, Brevo, Mailgun):
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.

Порядок: облачный Supabase → импорт корпуса → владелец → Vercel preview → проверка → production
(только по решению владельца). Все секреты — только в серверных переменных Vercel и локальном
`.env.local`; в репозиторий и в браузер они не попадают.

## 1. Supabase (облако)

1. Создайте проект на https://supabase.com (регион ЕС, например Frankfurt). Запишите
   *Project ref*, пароль БД.
2. Свяжите и примените миграции:
   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF>
   npx supabase db push
   ```
Шаги 3–6 сценарий выполняет сам (`supabase config push` с минимальным конфигом из шага 3 сценария);
вручную — так:

3. **Authentication → Sign In / Providers**: Email включён; **Allow new users to sign up — выключить**.
   Самостоятельная регистрация учеников работает и при выключенном флаге: заявку проверяет сервер
   GreekOS (режим, код, свободные места, лимит попыток) и отправляет письмо со ссылкой; прямые
   регистрации в обход сервера невозможны. Минимальная длина пароля 10.
4. **Authentication → URL Configuration**: Site URL = адрес приложения (preview/production);
   Redirect URLs: `https://<домен>/**`.
5. **Authentication → Emails → Templates**: вставьте содержимое `supabase/templates/invite.html`,
   `recovery.html`, `magic_link.html` (ссылки ведут на `/auth/confirm?token_hash=…`).
   Можно также выполнить `npx supabase config push`, если ваша версия CLI это поддерживает.
6. **SMTP** (Authentication → Emails → SMTP): подключите свой почтовый сервис — встроенный
   отправитель Supabase имеет жёсткие лимиты (несколько писем в час). **Для самостоятельной
   регистрации SMTP обязателен**: без письма ученик не подтвердит адрес. Без SMTP регистрацию
   оставьте «закрытой» и приглашайте учеников из админки («Ссылка для ручной передачи»).
   Тема письма-приглашения: «GreekOS — ссылка для входа в курс» (`supabase/config.toml`).
7. **Database → Publications**: убедитесь, что `learner_events` входит в `supabase_realtime`
   (миграция добавляет её автоматически).
8. Ключи: Project Settings → API: `URL`, `anon`/publishable key, `service_role`/secret key.
   Строка прямого подключения для импорта: Project Settings → Database → Connection string (URI, direct).

## 2. Импорт корпуса (с вашего компьютера)

```bash
cd greekos
export NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
export DATABASE_URL='postgresql://postgres:<пароль>@db.<ref>.supabase.co:5432/postgres'
export CORPUS_ROOT=../spec/GreekOS_CLAUDE_UPLOAD_READY
npm run import:validate && npm run import      # повторный запуск безопасен
IMPORT_REPORT_DIR=../verification/import-cloud npm run import   # сохранить отчёт
```
Импорт выполняется одной транзакцией; при любой ошибке ничего не записывается. Пост-условие:
1843 задания, 87 уроков, 0 выпущенных.

## 3. Владелец

```bash
APP_URL=https://<домен> npx tsx scripts/create-owner.ts --email <ваш e-mail> --name "<Имя>"
```
Придёт письмо-приглашение → задать пароль. Роль `owner_admin` хранится в защищённой таблице,
не в метаданных пользователя.

### 3a. Регистрация учеников

Админ → **Ученики** → «Регистрация учеников»: режим «закрыта / по коду / открыта» и число мест
(по умолчанию открыта, 5 мест). Код показывается один раз; хранится только его хеш. Ссылка для
учеников: `https://<домен>/register`. В Vercel задайте `REGISTRATION_SALT` (случайная строка ≥ 24
символов) — соль для хешей IP и e-mail в журнале попыток.

## 4. Провайдеры (ключи нужны от владельца)

| Назначение | Переменные | Где взять |
|---|---|---|
| AI-оценщик и диалог (Claude) | `ANTHROPIC_API_KEY`; модели по умолчанию `claude-opus-5-5` (`LLM_MODEL_DIALOGUE`, `LLM_MODEL_ASSESSOR`) | console.anthropic.com → API Keys |
| Распознавание речи el-GR | `ASR_PROVIDER=openai` + `OPENAI_API_KEY` **или** `ASR_PROVIDER=azure` + `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | platform.openai.com · portal.azure.com (Speech) |
| Синтез речи el-GR | `TTS_PROVIDER=openai\|azure\|google` + ключ (`GOOGLE_TTS_API_KEY` для Google) и при желании `*_TTS_VOICES` | те же консоли; Google Cloud → Text-to-Speech API |
| Лимиты расходов | `BUDGET_DAILY_USD_PER_USER`, `BUDGET_MONTHLY_USD`, `AUDIO_RUN_BUDGET_USD` | оценки, не счета |

Необязательные адреса сервисов (частные конечные точки, прокси): `AZURE_SPEECH_TTS_URL`,
`AZURE_SPEECH_STT_URL`, `GOOGLE_TTS_URL`, `OPENAI_BASE_URL`. По умолчанию — публичные адреса
провайдеров.

**Качественные голоса для курса (рекомендуется Azure Speech).** Одного ключа Azure достаточно для
всех 142 аудиозаданий: каталог берёт греческие нейронные голоса (Athina — женский, Nestoras —
мужской) и многоязычные нейронные голоса, которые говорят по-гречески (второй женский и второй
мужской — для диалогов двух женщин и сцен на четырёх участников). Предложения кастинга ставят
родные греческие голоса выше многоязычных и заменяют ими локальные голоса разработки; утверждает
владелец. Записи облачными голосами ждут записи условий провайдера (Админ → Аудио → карточка).

Имена голосов (например `el-GR-AthinaNeural`, `el-GR-Wavenet-A`) нужно сверить со списком
провайдера на дату подключения. После добавления ключей: Админ-панель → Провайдеры → «Проверить
подключение» (реальный короткий вызов; результат пишется в журнал аудита).
Также задайте условия хранения данных у провайдера (zero/limited retention), прежде чем
включать голос ученикам.

### 4a. Голоса и кастинг (v5.4)

1. После подключения TTS: Админ → **Голоса и кастинг** → «Обновить каталог и предложения». Каталог
   берёт пол голоса только из метаданных провайдера (Azure `Gender`, Google `ssmlGender`; у OpenAI
   пол не заявлен → `unspecified`, такой голос не назначается на женскую/мужскую роль).
2. Прослушать образец каждого голоса (кнопка «Образец»), утвердить голос, назначить голоса ролям
   `NARRATOR_F/M`, `ROLE_CAFE_F/M`, `TUTOR_F/M` и утвердить роли. Персонажей с именами
   (`Άννα`, `Νίκος`…) и общеродовыми существительными (`Υπάλληλος`) кастует владелец — система их не
   угадывает.
3. Запись условий провайдера (права) — Админ → Аудио → карточка задания. Голоса с правами
   «только разработка» (локальные голоса macOS) выпуску не подлежат.
4. Пакетная генерация — там же «Сгенерировать пакет» или `npm run audio -- render-batch --budget-cap N`;
   отчёт: `npm run audio -- report --out reports/v5.4`; бенчмарк голосов: `npm run audio:benchmark`.

### 4b. Голосовой шлюз (живой разговор)

Потоковый разговор (микрофон ↔ ответ голосом, перебивание) работает через отдельный процесс
`voice-gateway/server.ts` — долгоживущий WebSocket нельзя держать в serverless-функции Vercel.

- Хостинг: **Fly.io** (выбран как минимальная надёжная схема): образ `voice-gateway/Dockerfile`,
  настройки `voice-gateway/fly.toml` — регион `fra` рядом с Supabase EU и Azure westeurope, одна
  машина 512 МБ, `auto_stop_machines = "off"` и `min_machines_running = 1` (разговор не ждёт
  «холодного старта»), HTTPS/WSS и проверка `GET /health` силами Fly. Шлюз пингует соединения каждые
  15 с, поэтому простаивающий разговор не обрывается прокси. Для 4–5 учеников одной машины
  достаточно. Вручную:
  ```bash
  fly apps create greekos-voice
  ```
  ```bash
  fly secrets import --app greekos-voice < файл-с-переменными   # NAME=VALUE по строке, не коммитить
  ```
  ```bash
  fly deploy . --app greekos-voice --config voice-gateway/fly.toml --dockerfile voice-gateway/Dockerfile --remote-only
  ```
  Другой хостинг с тем же образом тоже подходит (Railway, Render, Cloud Run с `--no-cpu-throttling`
  и `min-instances=1`): TLS-прокси (wss://), idle-timeout ≥ 120 с, sticky-сессии не нужны.
- Переменные шлюза: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `APP_ENV`,
  `VOICE_GATEWAY_SECRET` (тот же, что у Vercel), `VOICE_GATEWAY_HOST=0.0.0.0`, `VOICE_GATEWAY_PORT`,
  ключи ASR/TTS/LLM, лимиты бюджета. Шлюз не принимает соединения без токена.
- В Vercel: `VOICE_GATEWAY_SECRET` и `NEXT_PUBLIC_VOICE_GATEWAY_URL=wss://voice.<домен>`.
- Без шлюза приложение автоматически предлагает пошаговый режим (запись → проверка → ответ),
  честно помеченный как менее интерактивный.
- Проверка: `GET https://<app>.fly.dev/health` → `{"ok":true,…,"providers":{…}}` (имена провайдеров,
  без ключей); живой разговор через шлюз с замером «конец речи → звук»:
  `npx tsx --conditions=react-server scripts/voice-smoke.ts --gateway wss://<app>.fly.dev --turns 4`
  (временный тестовый аккаунт, удаляется после проверки); Админ → Голоса → таблица задержек
  (p50/p95; цель пилота 1,5 / 3,5 с). Ошибки шлюза попадают в журнал ошибок владельца (Админ → Обзор).
- До утверждения голосов владельцем тьютор отвечает только текстом — это правило выпуска, не сбой.

## 5. Vercel

```bash
npx vercel login
npx vercel link                      # создать/связать проект, корень — папка greekos
```
Переменные (Settings → Environment Variables), отдельно для Preview и Production:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`APP_URL`, `APP_ENV` (`preview`/`production`), `CRON_SECRET` (случайная строка), ключи провайдеров,
лимиты, `VOICE_GATEWAY_SECRET`, `NEXT_PUBLIC_VOICE_GATEWAY_URL`. Значения `local` для
`ASR_PROVIDER`/`TTS_PROVIDER` в облаке не работают (только разработка). **Не задавайте** `DATABASE_URL`, `ALLOW_SYNTHETIC_PROVIDERS` и `CORPUS_ROOT` в Vercel.

```bash
npx vercel deploy                    # preview
npx vercel deploy --prod             # production — только по решению владельца
```
`vercel.json` включает ежедневный cron `/api/cron/retention` (удаление голосовых записей после
срока согласия). Для preview рекомендуется отдельный Supabase-проект с синтетическими
пользователями.

## 6. Проверка после развёртывания

- `GET /api/health` → `{"ok":true}`.
- Регистрация: открыть `/register` в приватном окне, получить письмо, задать пароль, пройти
  «С полного нуля» (→ алфавит) и «Уже изучал(а)» (→ диагностика → маршрут). Лишние тестовые
  аккаунты удалить в админке (Ученики → удалить данные).
- Вход владельцем, приглашение синтетического ученика, вход учеником в другом браузере.
- Админ → Политика выпуска: при осознанном решении подписать цифровую политику; выпустить один урок
  (например U-A1-007) и проверить, что ученик видит урок, а второй браузер обновляется без перезагрузки.
- Автоматические e2e/интеграционные тесты намеренно работают только с локальным стеком
  (защита от записи синтетики в облако). На preview пройдите те же сценарии вручную синтетическими
  аккаунтами `*@greekos.test` или подключите отдельный тестовый Supabase и снимите эту защиту осознанно.
