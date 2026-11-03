import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const PROMPT_FILE_PATH = path.join(ROOT_DIR, "prompt.txt");

export const PORT = process.env.PORT || 3050;

// Limits & Safety Guardrails
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_PAGES_LIMIT = 60; // Max pages per PDF bundle

// Concurrency Limits
export const GLOBAL_CONCURRENCY_SLOTS = 8; // Max parallel DeepSeek requests across whole server
export const DEFAULT_JOB_CONCURRENCY = 4; // Max parallel workers per single PDF job
