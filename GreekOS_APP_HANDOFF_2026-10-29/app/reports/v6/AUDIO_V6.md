# Аудио курса — статус всех заданий

Сформировано 2026-10-30T07:00:07.293Z (локальная среда). Всего заданий: 142.

Файлов: 123 · цифровая проверка пройдена: 68 · нужен разбор: 55 · техн. брак: 0 · роли без пола (кастинг владельца): 14 · нет голоса нужного пола: 5 · не отрендерено: 0.

- Local renders: Coqui VITS el (female, BSD-3; distributable after the owner records terms and listens) and MBROLA gr1/gr2 via espeak-ng (male, non-commercial: DEV_LOCAL_ONLY).
- ASR round-trip: local Whisper turbo (sherpa-onnx int8), per segment, phonetic comparison; a screening signal, not proof of pronunciation or naturalness.
- No job is silently skipped: every job has a status and reason. Casting proposals are unapproved until the owner approves them.

| Задание | Статус | Голоса | Сегменты (прошли/всего) | CER фонет. | Длит., с | Права | Причина |
|---|---|---|---|---|---|---|---|
| D-A1-LISTENING-01-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/3 | 0.0959 | 7.2 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| D-A2-LISTENING-01-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Υπάλληλος» без назначенного голоса (нужен кастинг владельцем) |
| D-B1-LISTENING-01-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 3/3 | 0.0432 | 14.0 | DEV_LOCAL_ONLY |  |
| KEG-B2-L01-AUD1 | AUDIO_VERIFIED_DIGITAL | Ελένη | 10/10 | 0.0405 | 186.9 | RIGHTS_PENDING |  |
| KEG-B2-L01-AUD2 | BLOCKED_NO_SUITABLE_VOICE | — | — | — | — | — | для ROLE_CAFE_F (female) нет голоса в каталоге |
| KEG-B2-L02-AUD1 | AUDIO_VERIFIED_DIGITAL | Ελένη | 10/10 | 0.0463 | 187.6 | RIGHTS_PENDING |  |
| KEG-B2-L02-AUD2 | BLOCKED_NO_SUITABLE_VOICE | — | — | — | — | — | для ROLE_CAFE_F (female) нет голоса в каталоге |
| KEG-B2-L03-AUD1 | NEEDS_REVIEW | Γιώργος | 9/10 | 0.0136 | 184.2 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| KEG-B2-L03-AUD2 | BLOCKED_NO_SUITABLE_VOICE | — | — | — | — | — | для ROLE_CAFE_F (female) нет голоса в каталоге |
| RG-0001-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/4 | 0.0471 | 8.3 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| RG-0002-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/4 | 0.0714 | 10.6 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| RG-0003-TONE01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 4/4 | 0.0165 | 11.3 | DEV_LOCAL_ONLY |  |
| RG-0004-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/4 | 0.0278 | 8.9 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| RG-0005-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/4 | 0.0395 | 9.1 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| RG-0006-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 1/4 | 0.0313 | 11.1 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| RG-0007-TONE01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 4/4 | 0.0364 | 9.2 | DEV_LOCAL_ONLY |  |
| RG-0008-TONE01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 4/4 | 0.0323 | 10.4 | DEV_LOCAL_ONLY |  |
| RG-0009-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/4 | 0.0777 | 10.1 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| RG-0010-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/4 | 0.0759 | 12.5 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| RG-0011-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/4 | 0.0459 | 9.4 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| RG-0012-TONE01 | NEEDS_REVIEW | Ελένη, Γιώργος | 1/4 | 0.1282 | 9.2 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A1-001-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Υπάλληλος» без назначенного голоса (нужен кастинг владельцем) |
| U-A1-002-AUD01 | BLOCKED_NO_SUITABLE_VOICE | — | — | — | — | — | для ROLE_CAFE_F (female) нет голоса в каталоге |
| U-A1-003-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 3/4 | 0.0392 | 10.7 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 1 |
| U-A1-004-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Οδηγός» без назначенного голоса (нужен кастинг владельцем) |
| U-A1-005-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Νικόλας» без назначенного голоса (нужен кастинг владельцем) |
| U-A1-006-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 3/4 | 0.02 | 9.5 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A1-007-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/5 | 0.0779 | 8.8 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-A1-008-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 1/3 | 0.1304 | 6.3 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-A1-009-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 2/4 | 0.093 | 7.5 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A1-010-AUD01 | NEEDS_REVIEW | Γιώργος, Νίκος | 2/4 | 0.0435 | 11.7 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A1-011-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 1/4 | 0.1453 | 11.2 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A1-012-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/6 | 0.0432 | 19.1 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 4 |
| U-A1-013-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 6/6 | 0.006 | 14.0 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 4 |
| U-A1-014-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 1/4 | 0.1185 | 11.1 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| U-A1-015-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/6 | 0.0496 | 12.1 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 4 |
| U-A1-016-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/7 | 0.098 | 12.4 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| U-A1-017-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 3/3 | 0.0068 | 12.9 | DEV_LOCAL_ONLY |  |
| U-A1-018-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/5 | 0.1333 | 12.8 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 2 |
| U-A1-019-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 0.9 | RIGHTS_PENDING |  |
| U-A1-019-AUD02 | NEEDS_REVIEW | Ελένη | 1/1 | 0 | 0.7 | RIGHTS_PENDING | возможный обрыв в конце сегментов 0 |
| U-A1-019-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 2.4 | RIGHTS_PENDING |  |
| U-A1-019-AUD04 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 2.4 | RIGHTS_PENDING |  |
| U-A1-019-AUD05 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0625 | 1.0 | RIGHTS_PENDING |  |
| U-A1-019-AUD06 | NEEDS_REVIEW | Ελένη | 1/1 | 0 | 1.0 | RIGHTS_PENDING | возможный обрыв в конце сегментов 0 |
| U-A1-019-AUD07 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0213 | 3.6 | RIGHTS_PENDING |  |
| U-A1-020-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 2.1 | RIGHTS_PENDING |  |
| U-A1-020-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 1.9 | RIGHTS_PENDING |  |
| U-A1-020-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.1163 | 2.6 | RIGHTS_PENDING |  |
| U-A1-020-AUD04 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0217 | 2.8 | RIGHTS_PENDING |  |
| U-A1-020-AUD05 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 3.7 | RIGHTS_PENDING |  |
| U-A1-020-AUD06 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0667 | 3.2 | RIGHTS_PENDING |  |
| U-A1-020-AUD07 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 3.5 | RIGHTS_PENDING |  |
| U-A1-020-AUD08 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0857 | 2.4 | RIGHTS_PENDING |  |
| U-A1-020-AUD09 | NEEDS_REVIEW | Ελένη | 0/1 | 0.1429 | 3.9 | RIGHTS_PENDING | ASR round-trip выше порогов — нужен разбор |
| U-A2-001-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/4 | 0.0282 | 13.2 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A2-002-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Υπάλληλος» без назначенного голоса (нужен кастинг владельцем) |
| U-A2-003-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Έλλη» без назначенного голоса (нужен кастинг владельцем) |
| U-A2-004-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 3/4 | 0.0479 | 11.7 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A2-005-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 4/4 | 0.0109 | 8.9 | DEV_LOCAL_ONLY |  |
| U-A2-006-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/4 | 0.066 | 10.0 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 2 |
| U-A2-007-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 3/3 | 0.0231 | 10.3 | DEV_LOCAL_ONLY |  |
| U-A2-008-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/3 | 0.0357 | 13.0 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-A2-009-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/5 | 0 | 16.2 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-A2-010-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 6/6 | 0.0231 | 14.4 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 4 |
| U-A2-011-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/8 | 0.0773 | 22.2 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 6 |
| U-A2-012-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/6 | 0.1145 | 19.0 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| U-A2-013-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 6/9 | 0.1382 | 24.7 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 4, 6 |
| U-A2-014-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 6/8 | 0.0395 | 21.7 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 2, 6 |
| U-A2-015-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 5/8 | 0.0708 | 20.8 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 4, 6 |
| U-A2-016-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 0.7 | RIGHTS_PENDING |  |
| U-A2-016-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 0.9 | RIGHTS_PENDING |  |
| U-A2-017-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0897 | 9.7 | RIGHTS_PENDING |  |
| U-A2-017-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0667 | 8.3 | RIGHTS_PENDING |  |
| U-A2-017-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0196 | 3.6 | RIGHTS_PENDING |  |
| U-A2-017-AUD04 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.043 | 7.5 | RIGHTS_PENDING |  |
| U-A2-017-AUD05 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 5.9 | RIGHTS_PENDING |  |
| U-A2-017-AUD06 | NEEDS_REVIEW | Ελένη | 0/1 | 0.0485 | 7.3 | RIGHTS_PENDING | ASR round-trip выше порогов — нужен разбор |
| U-A2-017-AUD07 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0676 | 5.7 | RIGHTS_PENDING |  |
| U-A2-018-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 4.4 | RIGHTS_PENDING |  |
| U-A2-018-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0857 | 2.1 | RIGHTS_PENDING |  |
| U-A2-018-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0814 | 6.0 | RIGHTS_PENDING |  |
| U-A2-018-AUD04 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0345 | 4.4 | RIGHTS_PENDING |  |
| U-A2-018-AUD05 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.027 | 2.4 | RIGHTS_PENDING |  |
| U-A2-018-AUD06 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0156 | 5.0 | RIGHTS_PENDING |  |
| U-A2-018-AUD07 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 4.0 | RIGHTS_PENDING |  |
| U-A2-018-AUD08 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0357 | 6.6 | RIGHTS_PENDING |  |
| U-B1-001-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 3/4 | 0.0144 | 15.3 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-B1-002-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Ρένα» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-003-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/4 | 0.0621 | 11.5 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-B1-004-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Τάσος» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-005-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Βοηθός» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-006-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Ιώ» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-007-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Γραμματέας» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-008-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/4 | 0.0455 | 11.6 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 2 |
| U-B1-009-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 1/4 | 0.028 | 10.7 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| U-B1-010-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 4/5 | 0.066 | 16.3 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-B1-011-SCRIPT | NEEDS_REVIEW | Ελένη, Γιώργος | 6/7 | 0.0281 | 22.6 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-B1-012-SCRIPT | NEEDS_REVIEW | Γιώργος, Ελένη | 4/6 | 0.0389 | 21.5 | DEV_LOCAL_ONLY | ASR round-trip выше порогов — нужен разбор |
| U-B1-013-SCRIPT | NEEDS_REVIEW | Ελένη, Γιώργος | 6/6 | 0.013 | 18.9 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-B1-014-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/5 | 0.0481 | 15.8 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-B1-015-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Υπάλληλος» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-016-AUD01 | NEEDS_REVIEW | Γιώργος, Ελένη | 5/6 | 0.0118 | 14.1 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 1 |
| U-B1-017-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Υπάλληλος» без назначенного голоса (нужен кастинг владельцем) |
| U-B1-018-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0375 | 38.4 | RIGHTS_PENDING |  |
| U-B1-018-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0361 | 37.7 | RIGHTS_PENDING |  |
| U-B1-018-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0375 | 37.4 | RIGHTS_PENDING |  |
| U-B1-018-AUD04 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0505 | 38.4 | RIGHTS_PENDING |  |
| U-B1-018-AUD05 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0433 | 38.5 | RIGHTS_PENDING |  |
| U-B1-018-AUD06 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0065 | 9.6 | RIGHTS_PENDING |  |
| U-B1-018-AUD07 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0074 | 7.9 | RIGHTS_PENDING |  |
| U-B1-018-AUD08 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.05 | 8.7 | RIGHTS_PENDING |  |
| U-B1-019-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0658 | 39.3 | RIGHTS_PENDING |  |
| U-B1-019-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0549 | 40.0 | RIGHTS_PENDING |  |
| U-B1-019-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0837 | 40.4 | RIGHTS_PENDING |  |
| U-B1-019-AUD04 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.059 | 39.3 | RIGHTS_PENDING |  |
| U-B1-019-AUD05 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0796 | 40.4 | RIGHTS_PENDING |  |
| U-B1-019-AUD06 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0147 | 8.3 | RIGHTS_PENDING |  |
| U-B1-019-AUD07 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0103 | 5.6 | RIGHTS_PENDING |  |
| U-B1-019-AUD08 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0 | 9.1 | RIGHTS_PENDING |  |
| U-B1-021-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0968 | 2.0 | RIGHTS_PENDING |  |
| U-B1-021-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0968 | 1.9 | RIGHTS_PENDING |  |
| U-B2-001-AUD01 | BLOCKED_NO_SUITABLE_VOICE | — | — | — | — | — | для ROLE_CAFE_F (female) нет голоса в каталоге |
| U-B2-002-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 2/4 | 0.0233 | 12.3 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-B2-003-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 3/4 | 0.0526 | 12.2 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0, 2 |
| U-B2-004-AUD01 | BLOCKED_MISSING_VOICE_METADATA | — | — | — | — | — | роль «Λέων» без назначенного голоса (нужен кастинг владельцем) |
| U-B2-005-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη, Γιώργος | 4/4 | 0.0088 | 17.3 | DEV_LOCAL_ONLY |  |
| U-B2-006-SCRIPT | NEEDS_REVIEW | Ελένη, Γιώργος | 7/7 | 0.021 | 26.3 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-B2-007-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 6/6 | 0.0142 | 24.3 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 0 |
| U-B2-008-AUD01 | NEEDS_REVIEW | Ελένη, Γιώργος | 5/6 | 0.0533 | 24.1 | DEV_LOCAL_ONLY | возможный обрыв в конце сегментов 2 |
| U-B2-012-AUD00 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0541 | 5.2 | RIGHTS_PENDING |  |
| U-B2-012-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 6/6 | 0.041 | 134.9 | RIGHTS_PENDING |  |
| U-B2-012-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0542 | 23.8 | RIGHTS_PENDING |  |
| U-B2-012-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0407 | 13.3 | RIGHTS_PENDING |  |
| U-B2-015-AUD01 | AUDIO_VERIFIED_DIGITAL | Ελένη | 12/12 | 0.0352 | 162.2 | RIGHTS_PENDING |  |
| U-B2-015-AUD02 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.096 | 26.6 | RIGHTS_PENDING |  |
| U-B2-015-AUD03 | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0603 | 20.9 | RIGHTS_PENDING |  |
| U-B2-016-I11-AUDIO | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0282 | 4.9 | RIGHTS_PENDING |  |
| U-B2-016-I12-AUDIO | NEEDS_REVIEW | Ελένη | 0/1 | 0.5077 | 4.9 | RIGHTS_PENDING | ASR round-trip выше порогов — нужен разбор |
| U-B2-016-I13-AUDIO | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0278 | 7.6 | RIGHTS_PENDING |  |
| U-B2-016-I14-AUDIO | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0185 | 7.8 | RIGHTS_PENDING |  |
| U-B2-016-I15-AUDIO | AUDIO_VERIFIED_DIGITAL | Ελένη | 1/1 | 0.0343 | 11.8 | RIGHTS_PENDING |  |
