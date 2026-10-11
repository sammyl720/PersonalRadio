import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const secret=randomBytes(32).toString("hex");
await writeFile("apps/site/.dev.vars","WORKER_HMAC_SECRET="+secret+"\nOWNER_CHATGPT_USER_ID=local_seedy\n");
await writeFile("apps/worker/.env.local","WORKER_HMAC_SECRET="+secret+"\nSITE_BASE_URL=http://127.0.0.1:5173\nPROVIDER_MODE=fixture\n");
console.log("Local fixture environment created in ignored files.");
