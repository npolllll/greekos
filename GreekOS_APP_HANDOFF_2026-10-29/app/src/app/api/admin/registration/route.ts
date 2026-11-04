import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { RegistrationUpdate, registrationSettings, updateRegistration } from '@/lib/registration';

export const GET = route(async () => {
  await apiOwner();
  return registrationSettings();
});

/** Owner: registration mode, learner seats, a new registration code (shown once). */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  return updateRegistration(owner, RegistrationUpdate.parse(await jsonBody(req)));
});
