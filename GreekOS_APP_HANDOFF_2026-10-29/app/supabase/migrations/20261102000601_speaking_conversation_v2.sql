-- Speaking conversation engine v2: a generative interlocutor with session memory, per-turn validated
-- feedback and an explicit engine label on every assistant line (AI vs scripted fallback).

-- Facts the conversation has established (short, model-proposed, guarded) and the free-talk topic thread.
alter table public.speaking_sessions add column if not exists memory jsonb not null default '{"facts": []}'::jsonb;

-- Which engine produced an assistant line: 'llm:<model>' (generated), 'authored' (scenario line chosen
-- deliberately), 'scripted_fallback' (the AI did not answer in time or failed a guard — labelled to the learner).
alter table public.speaking_turns add column if not exists engine text;
-- Validated feedback on a learner turn: {quote, better_el, why_ru, kind, source}; the quote is a verbatim
-- substring of the confirmed learner text, the better form passed the Greek guard. Never an assessment.
alter table public.speaking_turns add column if not exists feedback jsonb;
-- Server-side generation timings for the assistant line (first sentence / total), when generated.
alter table public.speaking_turns add column if not exists gen_first_ms integer;
alter table public.speaking_turns add column if not exists gen_total_ms integer;

alter table public.speaking_turns drop constraint if exists speaking_turns_engine_check;
alter table public.speaking_turns add constraint speaking_turns_engine_check
  check (engine is null or engine in ('authored', 'scripted_fallback') or engine like 'llm:%');

-- LLM time in the latency breakdown of a learner turn (end of speech → first audio).
alter table public.speaking_turn_metrics add column if not exists llm_first_sentence_ms integer;
alter table public.speaking_turn_metrics add column if not exists llm_total_ms integer;
