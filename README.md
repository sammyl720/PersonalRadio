# Personal Radio

A private, mobile-first radio library. Choose a topic, duration, and one or two host personas; review the voice quote; then listen to a generated, chaptered program. Finished episodes support saved playback position, questions, and MP3 export.

## Structure

- `apps/site`: Vinext/React interface, owner-only API, D1 metadata, R2 audio storage.
- `apps/worker`: separate Node and FFmpeg process for research, writing, speech, assembly, and listener answers.
- `packages/contracts`: request validation and API types.
- `packages/content`: cost estimates, speech chunking, byte-range parsing.
- `packages/providers`: OpenAI Responses and ElevenLabs adapters.

The worker claims fenced jobs through HMAC-authenticated Site endpoints. It checkpoints chapters and audio chunks so a retried job can resume. Audio is sent to R2 in verified multipart uploads. The Site serves authenticated range requests for seeking and downloads.

## Run locally

Use Node 22.13 or newer, FFmpeg with `ffprobe`, and npm. Run `npm install`, then `npm --prefix apps/site install`. Run `npm run setup:local` once to create ignored, matched local HMAC settings. Build the Site once, then apply its D1 migration from `apps/site`:

```sh
node /absolute/path/to/sites-plugin/scripts/build-site.mjs
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_luxuriant_tomorrow_man.sql
```

Start `npm run site:dev` and `npm run worker:dev` from the repository root in separate terminals. Visit `http://127.0.0.1:5173/signin-with-chatgpt?return_to=/` for the local mock owner. The local worker uses deterministic fixtures, so generation uses no paid provider calls.

Assign a fixture voice to a persona and set a voice rate in Settings before creating an episode. Generation pauses after the script is written for approval when its final voice quote exceeds the initial reserved estimate. `npm test`, `npx tsc --noEmit -p apps/site/tsconfig.json`, and `npm run worker:check` run the code checks. The Sites build uses `node <sites-plugin-root>/scripts/build-site.mjs` from `apps/site`.

## Hosted configuration

The Site is designed for an owner-private Sites project. Its `.openai/hosting.json` declares `DB` and `BUCKET`. Apply the tracked D1 migration to the hosted database before first use. Set Site runtime secrets `OWNER_CHATGPT_USER_ID` and `WORKER_HMAC_SECRET`; the owner ID must be the Site-scoped ChatGPT user ID shown on the signed-in setup screen. Until this ID is configured, the API fails closed.

Deploy `apps/worker` as a persistent Node service with `ffmpeg` and `ffprobe` on its path. Set `SITE_BASE_URL`, `WORKER_HMAC_SECRET` (exactly matching the Site), `SITES_SERVICE_BEARER` for access to the owner-private Site, `OPENAI_API_KEY`, and `ELEVENLABS_API_KEY`. `apps/worker/Dockerfile` is suitable for a container service. Keep the worker private; it only makes outbound requests. Optional model variables are `RESEARCH_MODEL`, `WRITING_MODEL`, `VOICE_MODEL`, `ECONOMY_VOICE_MODEL`, and `TRANSCRIPTION_MODEL`.

The default text model is `gpt-6-luna`; the voice profiles use ElevenLabs `eleven_v4` and `eleven_flash_v2_5`; transcription uses `scribe_v2`. Set the account-specific voice price in Settings before paid synthesis. Episode and monthly caps include a 20% voice retry reserve. Text, search, hosting, and provider charges are tracked or described separately; provider pricing can change, so the app does not claim an exact all-in price.

## Operational notes

- Job leases last two minutes and use a fencing number. A stopped worker can be replaced without allowing an old lease to write.
- A failed job can be retried from its checkpoint. Speech chunks are reused only when their text, voice, model, format, and settings cache key matches.
- The owner can cancel or delete an episode. Deletion queues cleanup of database records and R2 objects.
- The Site uses private, no-store API responses. Recordings are deleted after transcription unless retention is enabled.
- Browser playback behavior, iPhone installation, and provider billing should be checked with real accounts before relying on production output.

## API

The browser uses `/api/me`, `/api/settings`, `/api/personas`, `/api/voices`, `/api/episodes`, `/api/jobs`, `/api/voice-previews`, and `/api/episodes/:id/questions`. Worker endpoints live under `/api/internal/` and require signed requests. The UI and worker share schemas in `packages/contracts`.
