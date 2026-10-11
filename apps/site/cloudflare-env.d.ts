declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OWNER_CHATGPT_USER_ID?: string;
    WORKER_HMAC_SECRET?: string;
  }
}
