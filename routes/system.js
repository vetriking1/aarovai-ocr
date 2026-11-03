import express from "express";
import fs from "fs";
import { PROMPT_FILE_PATH } from "../config/constants.js";
import { openai } from "../lib/openai.js";

const router = express.Router();

/**
 * Reads system prompt from prompt.txt dynamically.
 * Throws a 500 exception if prompt.txt cannot be found or read.
 */
export function getSystemPrompt() {
  if (!fs.existsSync(PROMPT_FILE_PATH)) {
    const err = new Error(`System prompt file not found: ${PROMPT_FILE_PATH}`);
    err.status = 500;
    throw err;
  }
  try {
    return fs.readFileSync(PROMPT_FILE_PATH, "utf-8").trim();
  } catch (readErr) {
    const err = new Error(`Failed to read prompt file: ${readErr.message}`);
    err.status = 500;
    throw err;
  }
}

// Health check endpoint
router.get("/health", (req, res) => {
  const isKeyConfigured = Boolean(
    process.env.DEEPSEEK_API_KEY &&
    process.env.DEEPSEEK_API_KEY !== "your_deepseek_api_key_here"
  );

  res.json({
    status: "ok",
    apiKeyConfigured: isKeyConfigured,
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    promptFileLoaded: fs.existsSync(PROMPT_FILE_PATH),
    pdfEngine: "mupdf",
    concurrencySlots: 8,
  });
});

// View current system prompt
router.get("/api/prompt", (req, res) => {
  try {
    res.json({ prompt: getSystemPrompt() });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  }
});

// Root welcome & directory
router.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Aarov RMC OCR API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #222; }
          h1 { color: #4f46e5; }
          code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
          .endpoint { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
          .method { font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; margin-right: 8px; }
          .get { background: #dcfce7; color: #166534; }
          .post { background: #e0e7ff; color: #3730a3; }
          a { color: #4f46e5; text-decoration: none; font-weight: 500; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Aarov RMC - Batch Report OCR Engine</h1>
        <p>Production server active with MuPDF on-demand rendering, 4-worker Fair Scheduling, and instant 3s extraction.</p>
        
        <h2>Available Endpoints:</h2>
        
        <div class="endpoint">
          <span class="method post">POST</span> <code>/api/extract</code>
          <p>Extract structured JSON from batch reports. Accepts binary file upload (<code>file</code> field in FormData) OR JSON <code>pdfBase64</code>.</p>
        </div>

        <div class="endpoint">
          <span class="method get">GET</span> <a href="/dashboard"><code>/dashboard</code></a>
          <p>Tier 1 Live Real-Time Visualizer Dashboard (Telemetry, Active Workers, Peak Traffic, Latency).</p>
        </div>

        <div class="endpoint">
          <span class="method get">GET</span> <a href="/api/metrics"><code>/api/metrics</code></a>
          <p>Real-time system metrics snapshot (JSON format).</p>
        </div>

        <div class="endpoint">
          <span class="method get">GET</span> <a href="/health"><code>/health</code></a>
          <p>Health check & DeepSeek engine status.</p>
        </div>
      </body>
    </html>
  `);
});

export default router;
