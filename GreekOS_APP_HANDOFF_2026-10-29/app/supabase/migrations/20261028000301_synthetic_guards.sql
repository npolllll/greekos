-- Synthetic test transports (provider 'mock') can never become publishable audio.
alter table public.audio_assets
  add constraint audio_assets_mock_never_verified
  check (provider <> 'mock' or (digital_status <> 'AUDIO_VERIFIED_DIGITAL' and rights_status = 'RIGHTS_PENDING'));
