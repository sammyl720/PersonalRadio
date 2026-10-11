# Deployment

## Current state

The owner-private Site is published at `https://personal-radio.sammyl.chatgpt.site` from Site project `appgprj_6acbb5f26e7881919f9640fe992ad3bf`. D1 and R2 are declared in `apps/site/.openai/hosting.json`; Sites applies the tracked D1 migration on publication. The Site has secret `WORKER_HMAC_SECRET` and the trusted, Site-scoped `OWNER_CHATGPT_USER_ID`. The latest private deployment includes both. The production worker is pending a Railway credential; ElevenLabs API access and all three adapter endpoints have been verified.

## Finish owner setup

1. Add the owner's ElevenLabs API key as a secret to a persistent worker service. Add the reused OpenAI key there as a secret. Never set provider keys in the Site, browser, or Git repository.
2. Use the same `WORKER_HMAC_SECRET` in the worker and Site. Obtain the Site's service access bearer through the Sites owner API and set it as `SITES_SERVICE_BEARER` only in the worker. Set `SITE_BASE_URL=https://personal-radio.sammyl.chatgpt.site`.
3. Build the root `apps/worker/Dockerfile` as a continuously running Railway service. Keep its root build context at the monorepo root. The service needs no inbound public route. Set one replica initially and enable restart on failure. Watch logs for voice catalog sync and job claims.
4. In the app, choose actual account voices for the hosts and set the owner's effective voice rate and budgets. Create a short episode, approve the final quote if prompted, and verify its private audio and transcript.

The container installs Debian FFmpeg from the Bookworm package repository and prints `ffmpeg -version` during build. Record the exact production version in the deploy log. Local development used FFmpeg 8.1.2. Pin an image/package revision before a production audio regression rollout.

## Source and publication

GitHub development branch: `codex/implement-personal-radio` at `https://github.com/sammyl720/PersonalRadio`. The Site has a separate private source repository managed by Sites. For Site changes, build from `apps/site`, run the Sites source workflow, then save and deploy the matching pushed commit and archive privately. Preserve the owner-private audience. Site runtime secret changes require a deployment to take effect.

## Verification still required

Account rate check; Railway deployment and restart; a real news episode; a 60 minute recovery run; physical iPhone Safari and home screen PWA playback; MP3 export in airplane mode. Keep these pending until observed with the actual accounts and device.
