-- Streaming duplex speaking: what the learner actually heard of an interrupted AI turn,
-- and the "listening ready" latency after microphone permission.
alter table public.speaking_turns add column heard_text text, add column heard_ms integer;
alter table public.speaking_turn_metrics add column listen_ready_ms integer;
