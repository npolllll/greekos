import { route, jsonBody } from '@/lib/api';
import { apiOwner } from '@/lib/auth';
import { IssueAction, resolveIssue } from '@/lib/qa/release';

export const POST = route(async (req) => {
  const owner = await apiOwner();
  return resolveIssue(owner, IssueAction.parse(await jsonBody(req)));
});
