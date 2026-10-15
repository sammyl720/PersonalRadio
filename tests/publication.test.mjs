import assert from "node:assert/strict";
import { test } from "vitest";
import { publishedAtFromHtml, publicationDateForSource } from "../apps/worker/src/publication.ts";

test("publication metadata uses a stated publication date, not modification or retrieval time",()=>{
 assert.equal(publishedAtFromHtml('<meta property="article:modified_time" content="2025-06-02T10:00:00Z"><meta property="article:published_time" content="2025-06-01T09:00:00Z">'),"2025-06-01T09:00:00.000Z");
 assert.equal(publishedAtFromHtml('<script type="application/ld+json">{"datePublished":"2024-03-10","dateModified":"2024-03-11"}</script>'),"2024-03-10T00:00:00.000Z");
 assert.equal(publishedAtFromHtml('<time class="published" datetime="2023-08-05T14:30:00-04:00">August 5</time>'),"2023-08-05T18:30:00.000Z");
 assert.equal(publishedAtFromHtml('<meta property="article:modified_time" content="2025-06-02T10:00:00Z">'),null);
 assert.equal(publishedAtFromHtml('<meta property="article:published_time" content="2099-01-01">'),null);
});

test("publication lookup rejects local targets before fetching",async()=>{
 assert.equal(await publicationDateForSource("http://example.com/article/story"),null);
 assert.equal(await publicationDateForSource("https://127.0.0.1/article/story"),null);
 assert.equal(await publicationDateForSource("https://localhost/article/story"),null);
});
