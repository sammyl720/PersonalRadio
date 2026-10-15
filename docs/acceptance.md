# Acceptance checks

Run local checks with `npm run worker:check`, `npm run site:build`, and `RADIO_TEST_BASE_URL=http://127.0.0.1:5173 npm test` while the local Site and fixture worker are running. The fixture test creates and deletes its own episode and does not call paid providers.

## Verified on the private production Site

- Owner sign-in and private audio playback; unauthenticated API and audio requests return 401.
- A real Daniel voice preview, a four-chapter news episode, and one spoken answer from a text question.
- Answer replay returned to the paused episode position. Two signed-in tabs exercised both saved-position conflict choices.
- The ten-minute news request produced 11:43 of audio. Its sources included broad and irrelevant search results, so this episode does not pass the source-usability or duration evaluation. The subsequent research and assembly changes were evaluated in the 30-minute run below.
- A first 30-minute news request completed on 2026-10-13. The measured MP3 is 34:19, within the 15% duration tolerance, and authenticated browser playback started. Its final voice quote was $2.73 and its recorded monetary usage was about $2.25, still estimated rather than reconciled to a provider invoice. Its transcript cited a BBC schedule page and broad news indexes for specific claims, so that run failed source usability.
- A second 30-minute news request completed on 2026-10-13 after the source filter and saved-job citation cleanup were deployed. The five-chapter MP3 measures 32:59 (9.9% above the request), and authenticated browser playback started and paused. The final voice quote was $2.77 under the approved $5 cap; recorded monetary usage is about $2.27 and remains an estimate, not a provider invoice. The news cutoff was 6:54 PM EDT. All seven cited links opened to specific AP reports or official UK, Meta, and Google announcements dated October 13. Sampled claims matched the linked pages; this is a source-usability and duration pass, not an exhaustive independent fact check. That stored episode shows publication dates as unknown even though the linked pages display dates.

## October 15 fixes

- New researched episodes read explicit publication metadata from cited HTTPS pages. If the page has no usable publication timestamp or blocks the fetch, the date remains unknown. Existing episode records are not backfilled. The parser and private-address rejection pass local tests; a direct read of a GOV.UK press release returned its stated publication time. AP returned HTTP 403 in the same check, so those articles may still show unknown. A new paid production episode has not been run to validate broader publisher coverage.
- Mobile library cards retain the Favorite action, with a second Favorite control on the episode detail page. Settings now exposes the stored language, question, and recording-retention defaults. Episode detail lists provider operations and billable units beside estimated costs; it labels unknown costs and does not imply invoice reconciliation.

## Engaging delivery update

- New scripts use host tone, pace, and instructions; chapters are prompted for varied rhythm, concrete details, natural transitions, and light wit where appropriate. The reviewer checks for flat repetition and humor that trivializes harm.
- Eleven v4 receives bounded per-turn delivery cues while the transcript keeps only spoken words. Economy speech receives plain text. The final voice quote includes cue characters actually sent to synthesis.
- Local fixture generation, persistence, two-host playback, and spoken-answer flow passed on 2026-10-14 (11 tests total). A new paid live episode and listening evaluation of the revised writing and Eleven v4 delivery have not yet been run.
- A follow-up local run on 2026-10-14 passed all 12 tests. Its fixture script deliberately included a Markdown source link; the deterministic pre-speech review rewrote that chapter and a separate editorially flagged chapter before synthesis. New answers also get one plain-speech rewrite if they contain markup. The Site displays labels instead of raw Markdown URLs in older saved transcripts. No paid live listening evaluation has been run for these changes.
- The pacing pass on 2026-10-14 passed all 13 local tests. Chapter instructions now request 100–220 word spoken beats; any turn over 260 words, an all-neutral substantive chapter, or a substantive two-host chapter missing one host is flagged for rewrite before paid speech. The fixture deliberately created an overlong single-host turn in a two-host chapter and verified the completed transcript has shorter turns from both hosts. Already frozen scripts bypass the new quality rule when synthesis resumes. This has not yet been assessed by listening to new production audio.

## Paid live evaluation to schedule

1. Run a 60-minute explainer only after explicitly approving its cost and any needed episode-cap change; at the configured $0.08 per 1,000 characters, the initial voice estimate alone is about $5.02 including the 20% reserve, above the current $5 episode cap. Close the browser during generation and verify completion after reopening. The fixture recovery test already covers interrupted synthesis without paid provider calls.
2. For a two-host live evaluation, assign two distinct voices from the account catalog, generate a short episode, and check turn boundaries and both voices. This consumes provider credits and is separate from the single-host news test.

## Physical iPhone checks

Use the owner account and the private Site URL on an actual iPhone. Browser emulation does not satisfy these checks.

1. In Safari, start a ready episode, lock the screen for 20 minutes, use headphone play/pause and seek controls, then unlock and confirm the saved position. Repeat from an installed home-screen PWA.
2. During playback, receive a call or another audio interruption. Resume afterward; the app should keep the position and should not regenerate speech.
3. Ask a text question and a short microphone question while unlocked. Deny microphone permission once to verify that text remains available. Confirm that each answer saves and returns to the paused offset.
4. Use **Export MP3**, save the file to Files or a compatible audio app, enable airplane mode, and play the exported file. This checks the external personal copy; the PWA does not promise offline audio caching.
5. If a check fails, record iPhone model, iOS version, Safari versus PWA, network state, step, expected result, actual result, and approximate time. Do not include credentials or private audio in an issue report.

The production Site remains owner-private. No public sharing is needed for these checks.
