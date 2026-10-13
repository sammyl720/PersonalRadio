# Acceptance checks

Run local checks with `npm run worker:check`, `npm run site:build`, and `RADIO_TEST_BASE_URL=http://127.0.0.1:5173 npm test` while the local Site and fixture worker are running. The fixture test creates and deletes its own episode and does not call paid providers.

## Verified on the private production Site

- Owner sign-in and private audio playback; unauthenticated API and audio requests return 401.
- A real Daniel voice preview, a four-chapter news episode, and one spoken answer from a text question.
- Answer replay returned to the paused episode position. Two signed-in tabs exercised both saved-position conflict choices.
- The ten-minute news request produced 11:43 of audio. Its sources included broad and irrelevant search results, so this episode does not pass the source-usability or duration evaluation. The subsequent research and assembly changes were evaluated in the 30-minute run below.
- A fresh 30-minute news request completed on 2026-10-13. The measured MP3 is 34:19, within the 15% duration tolerance, and authenticated browser playback started. Its final voice quote was $2.73 and its recorded monetary usage was about $2.25, still estimated rather than reconciled to a provider invoice. Its transcript cites a BBC schedule page and broad news indexes for specific claims, so source usability remains a failed content check. The Site now shows only links cited by the transcript; a stricter research-source filter is being deployed for future runs.

## Paid live evaluation to schedule

1. After the stricter source filter is deployed, run another 30-minute news episode only with fresh approval for its provider spend. Inspect the cited links, cutoff, spoken claims, transcript, actual duration, and usage before accepting it as an A2/content evaluation pass. The current initial voice estimate is about $2.51 for 30 minutes, plus text, search, and hosting estimates. Stop before synthesis if the final quote exceeds the approved budget.
2. Run a 60-minute explainer only after explicitly approving its cost and any needed episode-cap change; at the configured $0.08 per 1,000 characters, the initial voice estimate alone is about $5.02 including the 20% reserve, above the current $5 episode cap. Close the browser during generation and verify completion after reopening. The fixture recovery test already covers interrupted synthesis without paid provider calls.
3. For a two-host live evaluation, assign two distinct voices from the account catalog, generate a short episode, and check turn boundaries and both voices. This consumes provider credits and is separate from the single-host news test.

## Physical iPhone checks

Use the owner account and the private Site URL on an actual iPhone. Browser emulation does not satisfy these checks.

1. In Safari, start a ready episode, lock the screen for 20 minutes, use headphone play/pause and seek controls, then unlock and confirm the saved position. Repeat from an installed home-screen PWA.
2. During playback, receive a call or another audio interruption. Resume afterward; the app should keep the position and should not regenerate speech.
3. Ask a text question and a short microphone question while unlocked. Deny microphone permission once to verify that text remains available. Confirm that each answer saves and returns to the paused offset.
4. Use **Export MP3**, save the file to Files or a compatible audio app, enable airplane mode, and play the exported file. This checks the external personal copy; the PWA does not promise offline audio caching.
5. If a check fails, record iPhone model, iOS version, Safari versus PWA, network state, step, expected result, actual result, and approximate time. Do not include credentials or private audio in an issue report.

The production Site remains owner-private. No public sharing is needed for these checks.
