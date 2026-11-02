-- Audio v6.1: casting proposals from Greek name morphology and for common-gender role nouns without
-- textual gender; finished recordings imported per job (studio / voice actor / external TTS).

alter table public.audio_job_casting drop constraint if exists audio_job_casting_source_check;
alter table public.audio_job_casting add constraint audio_job_casting_source_check
  check (source in ('owner', 'grammatical_gender_proposal', 'self_reference_proposal', 'narrator_default_proposal',
                    'article_reference_proposal', 'distinct_voice_proposal', 'name_morphology_proposal',
                    'common_gender_neutral_proposal', 'needs_casting'));
