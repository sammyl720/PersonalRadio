# Operations

## Monitor and recover

The worker polls D1-backed jobs. Leases last 120 seconds with a 30 second heartbeat; a replacement worker can reclaim an expired lease. Start only one worker replica until concurrency policy has been reviewed. Transient provider failures receive up to three attempts per unchanged stage or chunk, with jittered backoff that respects `Retry-After`; quota errors stop for owner action. If an episode fails, inspect its job state and error code in the UI, fix the credential, provider, or rate issue, and select Retry. Completed speech chunks with the same cache key are reused. A provider timeout may have been billed even when the local job reports failure; uncertain speech attempts keep a conservative cost entry. Compare provider request IDs and billing before repeating a paid run.

For a worker restart, stop the service, wait for any lease to expire, then restart it. Do not clear the D1 jobs table to recover a stalled run. If a job stays `running` beyond the lease, verify the Site service bearer and HMAC secret, then inspect Site Worker logs and worker logs. The Site must remain owner-private.

## Keys and budget

Rotate the OpenAI and ElevenLabs keys in worker secrets and restart the worker. To rotate `WORKER_HMAC_SECRET`, update the Site secret, deploy a new Site revision, then update and restart the worker promptly; job leases will recover. Rotate the Sites service bearer in the worker when Sites issues a replacement. Keep provider keys out of Site secrets.

Set the effective voice rate and episode, answer, and monthly caps in Settings. Unknown voice pricing blocks speech. Recorded usage entries distinguish estimated, confirmed, unknown, and uncertain costs; provider invoices remain the final billing source. Include possibly billed timeouts when reviewing available monthly budget. Do not assume replay or export makes another provider call.

## Storage and backups

D1 holds metadata and job history; R2 holds private audio. Use the hosting provider's supported D1 export/backup and R2 object copy tools, and protect both exports as personal data. Restore D1 and R2 from the same point in time when possible, then verify that every ready episode's final asset exists. Avoid rerunning migrations already recorded as applied. Exported MP3 files are independent copies and cannot be revoked by removing a Site asset.

Deleting an episode marks it unavailable immediately and queues R2/database cleanup. Verify the cleanup job completes before treating removal as final. To delete all personal content, stop the worker, remove the Site and worker services, delete the D1 database and R2 bucket through the hosting provider, and remove any external backups and exported copies. A service worker caches static assets only; Settings can remove app managed caches.

If a multipart upload is stranded after a worker crash, inspect the asset's upload state and abort it through the provider tools before deleting its metadata. Periodically remove expired HMAC nonces, expired idempotency keys, and failed temporary assets after confirming no active retry uses them.
