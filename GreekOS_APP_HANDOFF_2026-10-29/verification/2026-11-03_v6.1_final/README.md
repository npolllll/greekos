# Проверка v6.1 — 03.11.2026

Локальная среда: Linux-контейнер, 4 CPU, без GPU; Supabase в Docker; локальные Whisper, Coqui VITS,
MBROLA и Gemma 4 E2B (node-llama-cpp). Облако и платные API не использовались.

| Файл | Что | Итог |
|---|---|---|
| 01_typecheck.log | `tsc --noEmit` | exit 0 |
| 02_lint.log | `eslint .` | exit 0 |
| 03_unit.log | `vitest --project unit` | 88 passed, 16 skipped (нет SPEC-фикстур) |
| 04_integration.log | `vitest --project integration` | 49/49 (на коммите исправления шлюза; позже менялись только тексты UI) |
| 05_e2e.log | `playwright test` | 29/29 |
| 06_contrast_pixel_check.log | пиксельная проверка WCAG AA | 0 из 1 953 ниже нормы |

Первые прогоны (`*a_*_first_run.log`) сохранены как есть: e2e 28/29 — голосовой поток в браузере;
причина — потеря строки метрик у перебитого потокового ответа (исправлено, см. docs/STATUS_V7.md).
