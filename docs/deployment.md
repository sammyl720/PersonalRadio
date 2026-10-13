# Deployment

## Current state

The owner-private Site is published at `https://personal-radio.sammyl.chatgpt.site` from Site project `appgprj_6acbb5f26e7881919f9640fe992ad3bf`. D1 and R2 are declared in `apps/site/.openai/hosting.json`; Sites applies the tracked D1 migration on publication. The Site has secret `WORKER_HMAC_SECRET` and the trusted, Site-scoped `OWNER_CHATGPT_USER_ID`. Private deployment `appgdep_6ace2c1320c08191819ac3c39d9cfddd` succeeded on 2026-10-13. The owner view shows three hosts.

The production worker runs as the `PersonalRadio` service in Railway project `624b66d4-023f-45fd-b2fa-f28c97297fea`, production environment `0e3abada-963b-4cc7-b727-615d995f53f2`. Deployment `7dfb51f9-9c9e-43a2-871f-0a6c198c5cd5` of Git commit `f5ad253` reached `SUCCESS` on 2026-10-13. Railway uses the `codex/implement-personal-radio` GitHub branch, root build context, and `/apps/worker/Dockerfile`. Watch paths cover the worker, shared packages, and root package manifests. It has one replica, restart on failure, and no public domain.

## Production configuration

The worker service has `SITE_BASE_URL`, `SITES_SERVICE_BEARER`, `WORKER_HMAC_SECRET`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and the selected model variables, including `REVIEW_MODEL=gpt-6.1-sol`. The HMAC secret matches the Site secret. Provider keys live only in worker variables, outside the browser, Site, and Git repository. Railway builds the root `apps/worker/Dockerfile` as a continuously running private service; no inbound public route is needed. New scripts receive a bounded factual review before paid speech synthesis; up to five flagged chapters can be rewritten once and reviewed again.

The owner chose the account voice Daniel – Steady Broadcaster for the default Calm Anchor host. The ElevenLabs subscription API reported Pay As You Go, with overage disabled. On 2026-10-12, [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) listed Eleven v4 at a temporary $0.022 per 1,000 characters through that date and a regular $0.08 rate. The owner approved saving the regular $0.08 rate and running a real ten-minute episode test. This is an estimated marginal voice rate; included or prepaid credits and other provider, storage, and hosting costs need separate reconciliation. A real 11.12-second Daniel voice preview was generated and loaded from the private audio endpoint. The episode and monthly caps remain $5 and $50.

The container installs Debian FFmpeg from the Bookworm package repository and prints `ffmpeg -version` during build. The successful production build installed FFmpeg 5.1.9-0+deb12u1. Local development used FFmpeg 8.1.2. Pin an image/package revision before a production audio regression rollout.

## Source and publication

GitHub development branch: `codex/implement-personal-radio` at `https://github.com/sammyl720/PersonalRadio`. Worker code changes on this branch deploy automatically through Railway. The Site has a separate private source repository managed by Sites. For Site changes, build from `apps/site`, run the Sites source workflow, then save and deploy the matching pushed commit and archive privately. Preserve the owner-private audience. Site runtime secret changes require a deployment to take effect.

## Verification still required

The local 60-minute fixture run wrote ten chapters, was interrupted at voice chunk 15 of 40, resumed after its lease expired, and finished with exactly 40 speech usage entries and a private MP3. The test episode was deleted after verification.

The first paid news episode is ready with four chapters and a private MP3. Browser playback worked, and a real chapter-specific text question produced a saved spoken answer. After the player fix in Site deployment `appgdep_6ace2c1320c08191819ac3c39d9cfddd`, replaying that answer returned to the paused episode at about 2:55 without a false cross-device warning. Estimated recorded usage was $0.83. The requested duration was ten minutes; the delivered audio was 11:43, outside the 15% target. Subsequent worker builds now correct modest duration drift during FFmpeg assembly and reject an out-of-range result. The first episode's source list also contained irrelevant search results and broad archive pages. Subsequent research builds now retain cited evidence links ahead of search result lists and ask the model for direct story or official URLs. These changes need verification on a future production episode; they do not alter the completed one.

A 60-minute run with paid providers, physical iPhone Safari and home screen PWA playback, and MP3 export in airplane mode remain pending until observed with the actual account and device.
