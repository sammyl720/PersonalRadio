# Model selection and smoke tests

Checked 11 October 2026. Runtime model IDs are configurable through the worker environment; the defaults are in `.env.example`. The owner should recheck account availability and prices before setting a rate in Settings.

| Role | Endpoint | Model | State |
| --- | --- | --- | --- |
| Research | OpenAI Responses with `web_search` | `gpt-6-luna` | Live account smoke passed: response text and 24 returned source entries; 8,680 input and 88 output tokens. |
| Schema writing | OpenAI Responses with `text.format` JSON schema | `gpt-6-luna` | Live account smoke passed: 35 input and 14 output tokens. |
| Complex rewrite | OpenAI Responses | `gpt-6.1-sol` | Reserved for a bounded quality escalation; account smoke pending. |
| Default speech | ElevenLabs `POST /v1/text-to-dialogue` | `eleven_v4` | Live account smoke passed: 116 characters, 7.68 second MP3, 128.9 kbps, request ID present. |
| Economy speech | ElevenLabs voice specific `POST /v1/text-to-speech/{voice_id}` | `eleven_flash_v2_5` | Live account smoke passed: 71 characters, MP3 returned, request ID present. |
| Recording transcription | ElevenLabs `POST /v1/speech-to-text` | `scribe_v2` | Live account smoke passed with a five second WebM/Opus recording; transcript returned. Response did not include a request ID. |

The OpenAI smoke used a small schema response and a one sentence web search prompt. The web search response included a large retrieved context; it is a capability check, not a price estimate. ElevenLabs calls were limited to short samples and one short transcription. The fixture worker produced an end to end local episode and answer without claiming real provider output.

The default v4 voice request sends explicitly ordered speaker inputs with `model_id=eleven_v4` and `mp3_44100_128`. Synthesis chunks are bounded to 1,700 characters and split at sentence boundaries. Economy uses the separate voice specific endpoint. The price field in Settings is the owner's own effective USD rate per 1,000 characters; there is no claim that subscription credits have zero cost. The pricing assumption version is `2026-10-11-owner-rate-v1`. Hosting, text, search, and transcription costs are separate from the displayed voice estimate.

Before changing a default model, run the adapter smoke plus a short current news briefing, an evergreen explanation, a disputed claim, a two host chapter, and a chapter specific answer. Check source support, continuity, repetition, spoken length, and audio quality. A provider error must be visible rather than silently replaced by fixtures.
