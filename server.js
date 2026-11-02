import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as mupdf from "mupdf";

// Load environment variables from .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPT_FILE_PATH = path.join(__dirname, "prompt.txt");

/**
 * Structured logger with ISO/local timestamps (PM2 friendly)
 */
const logger = {
  getTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return `${date} ${time}`;
  },
  info(msg, ...args) {
    console.log(`[${this.getTimestamp()}] [INFO] ${msg}`, ...args);
  },
  warn(msg, ...args) {
    console.warn(`[${this.getTimestamp()}] [WARN] ${msg}`, ...args);
  },
  error(msg, ...args) {
    console.error(`[${this.getTimestamp()}] [ERROR] ${msg}`, ...args);
  },
  http(msg, ...args) {
    console.log(`[${this.getTimestamp()}] [HTTP] ${msg}`, ...args);
  },
};

const app = express();
const PORT = process.env.PORT || 3050;

// HTTP request logger middleware (logs response status, duration, and IP)
app.use((req, res, next) => {
  const start = Date.now();
  const clientIp =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local";

  res.on("finish", () => {
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    logger.http(
      `${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}s) [${clientIp}]`
    );
  });

  next();
});

// Middleware (allow large payloads for base64 images)
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize OpenAI client with DeepSeek baseURL
const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * Reads system prompt from prompt.txt dynamically.
 * Throws a 500 exception if prompt.txt cannot be found or read.
 */
function getSystemPrompt() {
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

/**
 * Checks if a buffer begins with PDF magic bytes (%PDF)
 */
function isPdfBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer.subarray(0, 4).toString("ascii") === "%PDF";
}

/**
 * Converts a PDF buffer into an array of base64 PNG data URLs (one per page)
 * @param {Buffer|Uint8Array} pdfBuffer
 * @param {number} scale Rendering scale factor (default 2.0 = ~150-200 DPI)
 * @returns {string[]} Array of data URLs (data:image/png;base64,...)
 */
function convertPdfBufferToImages(pdfBuffer, scale = 2.0) {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const numPages = doc.countPages();
  const imageUrls = [];

  for (let i = 0; i < numPages; i++) {
    const page = doc.loadPage(i);
    const transform = mupdf.Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(
      transform,
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );
    const pngBuffer = Buffer.from(pixmap.asPNG());
    imageUrls.push(`data:image/png;base64,${pngBuffer.toString("base64")}`);
  }

  return imageUrls;
}

/**
 * Converts a file path to base64 data URL
 */
function fileToDataUrl(filePath) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found at path: ${resolvedPath}`);
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mime = mimeMap[ext] || "image/jpeg";
  const base64Data = fs.readFileSync(resolvedPath).toString("base64");
  return `data:${mime};base64,${base64Data}`;
}

/**
 * Normalizes input image string into a valid data URL
 */
function normalizeImageUrl(imageInput) {
  if (!imageInput) return null;
  const trimmed = imageInput.trim();
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }
  // Assume raw base64 jpeg by default
  return `data:image/jpeg;base64,${trimmed}`;
}

/**
 * Resolves images from request payload.
 * Supports:
 * - Single/Multi-page PDF file paths (`pdfPath`, `filePath`, `imagePath`)
 * - PDF base64 / data URL (`pdf`, `pdfBase64`, `file`, `fileBase64`, `image`, `imageBase64`)
 * - Image paths or base64 strings
 * - Arrays of images/files (`images`, `files`)
 * Returns array of image data URLs ready for OpenAI vision API.
 */
function resolveImagesFromRequest(body, defaultScale = 2.0) {
  const scale = typeof body.scale === "number" ? body.scale : defaultScale;
  const resultImages = [];
  let isPdfDetected = false;

  // 1. Check file path inputs: pdfPath, filePath, or imagePath
  const filePathInput = body.pdfPath || body.filePath || body.imagePath;
  if (filePathInput && typeof filePathInput === "string") {
    const resolvedPath = path.isAbsolute(filePathInput)
      ? filePathInput
      : path.join(__dirname, filePathInput);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found at path: ${resolvedPath}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const fileBuffer = fs.readFileSync(resolvedPath);

    if (ext === ".pdf" || isPdfBuffer(fileBuffer)) {
      isPdfDetected = true;
      const pdfImages = convertPdfBufferToImages(fileBuffer, scale);
      resultImages.push(...pdfImages);
    } else {
      resultImages.push(fileToDataUrl(resolvedPath));
    }
  }

  // 2. Check inline base64 / data URL: pdf, pdfBase64, file, fileBase64, image, imageBase64
  const inlineInput =
    body.pdf ||
    body.pdfBase64 ||
    body.file ||
    body.fileBase64 ||
    body.image ||
    body.imageBase64;
  if (inlineInput && typeof inlineInput === "string") {
    const trimmed = inlineInput.trim();
    if (trimmed.startsWith("data:application/pdf")) {
      isPdfDetected = true;
      const base64Part = trimmed.split(",")[1] || "";
      const buf = Buffer.from(base64Part, "base64");
      resultImages.push(...convertPdfBufferToImages(buf, scale));
    } else if (trimmed.startsWith("JVBERi0") || trimmed.startsWith("%PDF")) {
      // Raw PDF base64 or ASCII
      isPdfDetected = true;
      const buf = trimmed.startsWith("%PDF")
        ? Buffer.from(trimmed)
        : Buffer.from(trimmed, "base64");
      resultImages.push(...convertPdfBufferToImages(buf, scale));
    } else {
      const normalized = normalizeImageUrl(trimmed);
      if (normalized) {
        resultImages.push(normalized);
      }
    }
  }

  // 3. Check array inputs: images or files
  const listInput = body.images || body.files;
  if (Array.isArray(listInput)) {
    for (const item of listInput) {
      if (typeof item === "string") {
        const resolvedPath = path.isAbsolute(item)
          ? item
          : path.join(__dirname, item);
        if (fs.existsSync(resolvedPath)) {
          const ext = path.extname(resolvedPath).toLowerCase();
          const buf = fs.readFileSync(resolvedPath);
          if (ext === ".pdf" || isPdfBuffer(buf)) {
            isPdfDetected = true;
            resultImages.push(...convertPdfBufferToImages(buf, scale));
          } else {
            resultImages.push(fileToDataUrl(resolvedPath));
          }
        } else if (
          item.startsWith("data:application/pdf") ||
          item.startsWith("JVBERi0")
        ) {
          isPdfDetected = true;
          const base64Part = item.startsWith("data:application/pdf")
            ? item.split(",")[1]
            : item;
          const buf = Buffer.from(base64Part, "base64");
          resultImages.push(...convertPdfBufferToImages(buf, scale));
        } else {
          const normalized = normalizeImageUrl(item);
          if (normalized) resultImages.push(normalized);
        }
      }
    }
  }

  return {
    imageUrls: resultImages,
    isPdf: isPdfDetected,
    pageCount: resultImages.length,
  };
}

/**
 * Extracts and parses JSON safely from LLM text responses
 */
function extractJsonFromContent(content) {
  if (!content) return null;
  const trimmed = content.trim();

  // Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue
  }

  // Handle markdown code fences (```json ... ``` or ``` ... ```)
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Find outermost JSON brackets { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Executes async tasks over an array with controlled concurrency
 */
async function processWithConcurrency(items, concurrency, workerFn) {
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        try {
          results[idx] = await workerFn(items[idx], idx);
        } catch (err) {
          results[idx] = {
            page: idx + 1,
            success: false,
            error: err.message || "Failed to process page",
            data: null,
          };
        }
      }
    }
  );

  await Promise.all(workers);
  return results;
}

/**
 * Extracts data from a single image using the LLM
 */
async function extractSinglePage(
  imageUrl,
  pageIndex,
  systemPrompt,
  selectedModel,
  options = {}
) {
  const userMessageContent = [
    {
      type: "text",
      text:
        options.rawText ||
        "Extract structured data from this batch report according to the system instructions.",
    },
    {
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    },
  ];

  const completionParams = {
    model: selectedModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessageContent },
    ],
    stream: false,
  };

  if (options.thinking !== undefined) {
    completionParams.thinking = options.thinking;
  }
  if (options.reasoning_effort !== undefined) {
    completionParams.reasoning_effort = options.reasoning_effort;
  }

  const completion = await openai.chat.completions.create(completionParams);
  const messageContent = completion.choices[0]?.message?.content || "";
  const parsedData = extractJsonFromContent(messageContent);

  return {
    page: pageIndex + 1,
    success: Boolean(parsedData),
    data: parsedData,
    raw: messageContent,
    usage: completion.usage || null,
  };
}

// Health check endpoint
app.get("/health", (req, res) => {
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
  });
});

// View current system prompt
app.get("/api/prompt", (req, res) => {
  try {
    res.json({ prompt: getSystemPrompt() });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  }
});

// Utility endpoint: Convert a PDF to PNG images (useful for previewing or debugging pages)
app.post("/api/convert-pdf", (req, res) => {
  try {
    const { imageUrls, isPdf, pageCount } = resolveImagesFromRequest(req.body);
    if (pageCount === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No PDF file or valid pages found. Provide 'pdfPath', 'filePath', or 'pdfBase64'.",
      });
    }

    return res.json({
      success: true,
      pageCount,
      isPdf,
      images: imageUrls,
    });
  } catch (error) {
    console.error("PDF conversion error:", error);
    return res.status(400).json({
      success: false,
      error: error.message || "Failed to convert PDF.",
    });
  }
});

// Primary extraction endpoint (supports PDF, multiple pages, images, and text)
app.post("/api/extract", async (req, res) => {
  // Allow long timeout for large multi-page batch bundles (e.g., 10 to 50 pages)
  req.setTimeout(600000);

  try {
    const {
      text,
      invoiceText,
      content,
      model,
      prompt,
      thinking,
      reasoning_effort,
      concurrency,
    } = req.body;

    const rawText = text || invoiceText || content;

    // Resolve images/PDF pages
    let imageUrls = [];
    let isPdf = false;
    let pageCount = 0;

    try {
      const resolved = resolveImagesFromRequest(req.body);
      imageUrls = resolved.imageUrls;
      isPdf = resolved.isPdf;
      pageCount = resolved.pageCount;
    } catch (resolveErr) {
      return res.status(400).json({
        success: false,
        error: resolveErr.message,
      });
    }

    // Require either image/PDF or text input
    if (!rawText && imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required input. Provide 'pdfPath', 'filePath', 'imagePath', 'image', 'imageBase64', 'pdfBase64', or 'text' in the request body.",
      });
    }

    if (
      !process.env.DEEPSEEK_API_KEY ||
      process.env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here"
    ) {
      return res.status(500).json({
        success: false,
        error: "DEEPSEEK_API_KEY is not configured in .env file.",
      });
    }

    const systemPrompt = prompt || getSystemPrompt();
    const selectedModel =
      model || process.env.DEEPSEEK_MODEL || "deepseek-flash";

    // Case 1: Multiple pages (PDF with 2, 10, 50 pages or multiple images)
    // Send 1 page at a time with controlled concurrency and combine results into a single JSON
    if (imageUrls.length > 1) {
      const concurrencyLimit = Math.max(1, parseInt(concurrency, 10) || 3);
      logger.info(
        `Multi-page document detected: ${imageUrls.length} pages (Concurrency: ${concurrencyLimit}, Model: ${selectedModel})`
      );

      const pageResults = await processWithConcurrency(
        imageUrls,
        concurrencyLimit,
        async (url, idx) => {
          const pageStart = Date.now();
          logger.info(`[Page ${idx + 1}/${imageUrls.length}] Processing...`);
          const res = await extractSinglePage(
            url,
            idx,
            systemPrompt,
            selectedModel,
            {
              thinking,
              reasoning_effort,
              rawText,
            }
          );
          const pageDuration = ((Date.now() - pageStart) / 1000).toFixed(2);
          const batchInfo = res.data?.batchNumber
            ? ` (Batch #${res.data.batchNumber})`
            : "";
          logger.info(
            `[Page ${idx + 1}/${imageUrls.length}] Done in ${pageDuration}s${batchInfo}`
          );
          return res;
        }
      );

      const combinedReports = pageResults
        .filter((r) => r.success && r.data)
        .map((r) => r.data);

      const totalUsage = pageResults.reduce(
        (acc, r) => {
          if (r.usage) {
            acc.prompt_tokens += r.usage.prompt_tokens || 0;
            acc.completion_tokens += r.usage.completion_tokens || 0;
            acc.total_tokens += r.usage.total_tokens || 0;
          }
          return acc;
        },
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      );

      const failed = pageResults
        .filter((r) => !r.success || !r.data)
        .map((r) => ({ page: r.page, error: r.error || "Extraction failed" }));

      logger.info(
        `Extraction complete: ${combinedReports.length}/${imageUrls.length} reports successfully extracted (Total tokens: ${totalUsage.total_tokens || 0})`
      );

      const responsePayload = {
        success: combinedReports.length > 0,
        isPdf,
        pageCount: imageUrls.length,
        totalReports: combinedReports.length,
        data: combinedReports, // Lean array of extracted reports
        usage: totalUsage,
      };

      if (failed.length > 0) {
        responsePayload.failed = failed;
      }

      if (req.body.includeRaw || req.query?.includeRaw === "true") {
        responsePayload.raw = pageResults.map((r) => r.raw);
      }

      return res.json(responsePayload);
    }

    // Case 2: Single page / Single image
    if (imageUrls.length === 1) {
      logger.info(
        `Single page document detected (Model: ${selectedModel}, IsPDF: ${isPdf})`
      );

      const singleResult = await extractSinglePage(
        imageUrls[0],
        0,
        systemPrompt,
        selectedModel,
        {
          thinking,
          reasoning_effort,
          rawText,
        }
      );

      const batchInfo = singleResult.data?.batchNumber
        ? ` (Batch #${singleResult.data.batchNumber})`
        : "";
      logger.info(`Single page extraction completed${batchInfo}`);

      const responsePayload = {
        success: singleResult.success,
        isPdf,
        pageCount: 1,
        totalReports: singleResult.data ? 1 : 0,
        data: singleResult.data, // Single clean JSON object
      };

      if (singleResult.usage) {
        responsePayload.usage = {
          prompt_tokens: singleResult.usage.prompt_tokens || 0,
          completion_tokens: singleResult.usage.completion_tokens || 0,
          total_tokens: singleResult.usage.total_tokens || 0,
        };
      }

      if (req.body.includeRaw || req.query?.includeRaw === "true") {
        responsePayload.raw = singleResult.raw;
      }

      return res.json(responsePayload);
    }

    // Case 3: Text-only input
    logger.info(
      `Text-only extraction requested with model: ${selectedModel}`
    );

    const completionParams = {
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: rawText },
      ],
      stream: false,
    };

    if (thinking !== undefined) {
      completionParams.thinking = thinking;
    }
    if (reasoning_effort !== undefined) {
      completionParams.reasoning_effort = reasoning_effort;
    }

    const completion = await openai.chat.completions.create(completionParams);
    const messageContent = completion.choices[0]?.message?.content || "";
    const parsedData = extractJsonFromContent(messageContent);

    const responsePayload = {
      success: Boolean(parsedData),
      data: parsedData,
    };

    if (completion.usage) {
      responsePayload.usage = {
        prompt_tokens: completion.usage.prompt_tokens || 0,
        completion_tokens: completion.usage.completion_tokens || 0,
        total_tokens: completion.usage.total_tokens || 0,
      };
    }

    if (req.body.includeRaw || req.query?.includeRaw === "true") {
      responsePayload.raw = messageContent;
    }

    return res.json(responsePayload);
  } catch (error) {
    logger.error("Extraction error:", error.message || error);
    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      success: false,
      error:
        error.message || "An error occurred while processing with DeepSeek.",
      details: error.response?.data || error.error || null,
    });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send(`
    <h2>GST Invoice & Batch Report OCR API</h2>
    <p>Server is running. Supports text, single images, and multi-page PDFs (auto-converted to images and analyzed via DeepSeek).</p>
    <ul>
      <li><strong>GET /health</strong> - Server health status & engine check</li>
      <li><strong>GET /api/prompt</strong> - View loaded system prompt</li>
      <li><strong>POST /api/convert-pdf</strong> - Convert PDF to PNG images (preview pages)</li>
      <li><strong>POST /api/extract</strong> - Extract structured JSON (accepts <code>pdfPath</code>, <code>filePath</code>, <code>imagePath</code>, <code>pdfBase64</code>, <code>imageBase64</code>, or <code>text</code>)</li>
    </ul>
  `);
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT} (PID: ${process.pid})`);
  logger.info(`DeepSeek BaseURL: ${openai.baseURL}`);
  logger.info(`Prompt file path: ${PROMPT_FILE_PATH}`);
  if (
    !process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here"
  ) {
    logger.warn("⚠️  WARNING: DEEPSEEK_API_KEY is not set in .env.");
  } else {
    logger.info("DeepSeek API Key is configured.");
  }
});

// Graceful shutdown handlers for PM2 / Docker / systemd
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down HTTP server gracefully...`);
  server.close(() => {
    logger.info("HTTP server closed. Exiting process.");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced exit after shutdown timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

export default app;
