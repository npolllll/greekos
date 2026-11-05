# Приёмка v7 — 03.11.2026

`bash scripts/acceptance.sh` на текущем HEAD ветки; локальная среда: Linux, 4 CPU, без GPU, Supabase
в Docker, Whisper / Coqui / MBROLA, Gemma 4 E2B (node-llama-cpp). Облако и платные API не использовались.

| Файл | Шаг | Итог |
|---|---|---|
| 00_local_doctor.log | что реально запущено | ok |
| 01_typecheck.log / 02_lint.log | TypeScript / ESLint | 0 / 0 |
| 03_unit.log | unit | 96 passed, 16 skipped |
| 04_integration.log | интеграция | 49/49 |
| 05_e2e.log | e2e (включая product.spec: корпус, уровни, экзамен, админка) | 34/34 |
| 06_rules_on_corpus.log, rules/ | правила курса на выверенном корпусе | 0 ложных срабатываний |
| 07_speaking_latency.log, speaking-latency/ | задержка AI-собеседника | p50 2,5 с до первого предложения |
| 08_admission_plan.log, admission/ | план допуска | 1 645 / 177 / 1 / 20 |
| 09_build.log | next build | ok |
| 10_contrast_pixel_check.log | контраст WCAG AA по пикселям | 0 из 2 460 ниже нормы |

`SUMMARY.txt` — коды выхода шагов (0 = успешно). Первый прогон того же дня — в
`../2026-11-03_acceptance_first_run` (unit-тест «без модели» зависел от `.env.local`; исправлено).
