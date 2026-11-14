#!/usr/bin/env bash
# GreekOS ops — read-only facts about the Vercel project: Git link (does a push to a branch deploy by
# itself?), production branch, Fluid compute, function region, and the recent production deployments
# with the commit they were built from. Prints no secrets and no environment variable values.
set -euo pipefail
: "${VERCEL_TOKEN:?}"
API=https://api.vercel.com
Q="slug=${VERCEL_TEAM_SLUG:-masha-7f7d}"
H=(-H "Authorization: Bearer $VERCEL_TOKEN")
P=$(curl -fsS "${H[@]}" "$API/v9/projects/greekos-course?$Q")
echo "$P" | jq '{name, framework, rootDirectory, nodeVersion, serverlessFunctionRegion, link: (.link // null | if . then {type, repo: (.org + "/" + .repo), productionBranch, gitCredentialId: (.gitCredentialId != null), deployHooks: (.deployHooks | length)} else null end), fluid: (.resourceConfig.fluid // .defaultResourceConfig.fluid // null), functionDefaultTimeout: (.resourceConfig.functionDefaultTimeout // null), functionDefaultMemoryType: (.resourceConfig.functionDefaultMemoryType // null), ssoProtection: (.ssoProtection // null), passwordProtection: (.passwordProtection != null), gitForkProtection, autoAssignCustomDomains}'
PID=$(echo "$P" | jq -r .id)
echo "== recent deployments (production first)"
curl -fsS "${H[@]}" "$API/v6/deployments?projectId=$PID&limit=12&$Q" | jq -r '.deployments[] | [(.created/1000 | todate), .target // "preview", .state // .readyState, .source // "-", (.meta.githubCommitRef // .meta.gitBranch // "-"), ((.meta.githubCommitSha // .meta.greekosCommit // "-")[0:9]), .url] | @tsv'
