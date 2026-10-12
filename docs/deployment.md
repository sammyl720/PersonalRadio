# Deployment

## Current state

The owner-private Site is published at `https://personal-radio.sammyl.chatgpt.site` from Site project `appgprj_6acbb5f26e7881919f9640fe992ad3bf`. D1 and R2 are declared in `apps/site/.openai/hosting.json`; Sites applies the tracked D1 migration on publication. The Site has secret `WORKER_HMAC_SECRET` and the trusted, Site-scoped `OWNER_CHATGPT_USER_ID`. Private deployment `appgdep_6acd1f404dfc8191b34d323e59eabaf6` succeeded on 2026-10-12. A first-request preset race was fixed and the owner view shows three unassigned hosts.

The production worker runs as the `PersonalRadio` service in Railway project `624b66d4-023f-45fd-b2fa-f28c97297fea`, production environment `0e3abada-963b-4cc7-b727-615d995f53f2`. Deployment `89802632-7e29-40b2-a214-cf3276fadd20` of Git commit `77faa40` reached `SUCCESS` with one running instance on 2026-10-12. The worker authenticated to the Site and populated its live voice catalog. Railway uses the `codex/implement-personal-radio` GitHub branch, root build context, and `/apps/worker/Dockerfile`. The Dockerfile path is set explicitly on the service for automatic deployments. Watch paths cover the worker, shared packages, and root package manifests. It has one replica, restart on failure, and no public domain.

## Production configuration

The worker service has `SITE_BASE_URL`, `SITES_SERVICE_BEARER`, `WORKER_HMAC_SECRET`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and the selected model variables, including `REVIEW_MODEL=gpt-6.1-sol`. The HMAC secret matches the Site secret. Provider keys live only in worker variables, outside the browser, Site, and Git repository. Railway builds the root `apps/worker/Dockerfile` as a continuously running private service; no inbound public route is needed. New scripts receive a bounded factual review before paid speech synthesis; up to five flagged chapters can be rewritten once and reviewed again.

In the app, choose actual account voices for the hosts and set the owner's effective voice rate and budgets. Create a short episode, approve the final quote if prompted, and verify its private audio and transcript.

The container installs Debian FFmpeg from the Bookworm package repository and prints `ffmpeg -version` during build. The successful production build installed FFmpeg 5.1.9-0+deb12u1. Local development used FFmpeg 8.1.2. Pin an image/package revision before a production audio regression rollout.

## Source and publication

GitHub development branch: `codex/implement-personal-radio` at `https://github.com/sammyl720/PersonalRadio`. Worker code changes on this branch deploy automatically through Railway. The Site has a separate private source repository managed by Sites. For Site changes, build from `apps/site`, run the Sites source workflow, then save and deploy the matching pushed commit and archive privately. Preserve the owner-private audience. Site runtime secret changes require a deployment to take effect.

## Verification still required

Account rate check; worker restart recovery; a real news episode; a 60 minute recovery run; physical iPhone Safari and home screen PWA playback; MP3 export in airplane mode. Keep these pending until observed with the actual accounts and device.
