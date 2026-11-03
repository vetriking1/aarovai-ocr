import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_PAGES_LIMIT,
  DEFAULT_JOB_CONCURRENCY,
} from "../config/constants.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import { scheduler } from "../lib/scheduler.js";
import {
  isPdfBuffer,
  openPdfDocument,
  validatePdfDocument,
  renderPageToDataUrl,
  fileToDataUrl,
  normalizeImageUrl,
} from "../lib/pdf.js";
import {
  extractSinglePage,
  extractJsonFromContent,
  openai,
} from "../lib/openai.js";
import { getSystemPrompt } from "./system.js";

const router = express.Router();

// Configure Multer for binary file uploads in RAM (MemoryStorage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES, // 50MB hard limit
  },
});

/**
 * Multer error handling wrapper to return clean, friendly JSON errors
 */
export function uploadMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: `File size exceeds the 50MB limit. Please upload a smaller PDF.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: `File upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to parse uploaded file.",
      });
    }
    next();
  });
}

/**
 * Primary extraction endpoint
 * Supports:
 * - Direct binary upload via FormData ("file")
 * - JSON Base64 string ("pdfBase64" or "pdf" or "imageBase64")
 * - Local file path ("pdfPath" or "filePath" or "imagePath")
 */
router.post("/api/extract", uploadMiddleware, async (req, res) => {
  // 10-minute HTTP socket safety timeout for large multi-page bundles
  req.setTimeout(600000);

  const startTime = Date.now();
  metrics.startRequest();

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
      scale = 2.0,
      pdfBase64,
      pdf,
      imageBase64,
      image,
      pdfPath,
      filePath,
      imagePath,
    } = req.body;

    const rawText = text || invoiceText || content;
    const selectedModel =
      model || process.env.DEEPSEEK_MODEL || "deepseek-flash";
    const systemPrompt = prompt || getSystemPrompt();

    // 1. Resolve Input File / Buffer
    let inputBuffer = null;
    let inputPath = null;
    let inlineImageUrl = null;
    let inputSizeBytes = 0;

    if (req.file) {
      // Binary multipart upload (Best performance: 0% Base64 bloat)
      inputBuffer = req.file.buffer;
      inputSizeBytes = req.file.size;
    } else if (pdfBase64 || pdf) {
      const rawBase64 = (pdfBase64 || pdf).replace(
        /^data:application\/pdf;base64,/,
        ""
      );
      inputBuffer = Buffer.from(rawBase64, "base64");
      inputSizeBytes = inputBuffer.length;
    } else if (pdfPath || filePath || imagePath) {
      const targetPath = pdfPath || filePath || imagePath;
      inputPath = path.isAbsolute(targetPath)
        ? targetPath
        : path.resolve(process.cwd(), targetPath);

      if (!fs.existsSync(inputPath)) {
        metrics.endRequest();
        return res.status(400).json({
          success: false,
          error: `File not found on server at: ${inputPath}`,
        });
      }
      inputBuffer = fs.readFileSync(inputPath);
      inputSizeBytes = inputBuffer.length;
    } else if (imageBase64 || image) {
      const rawImage = imageBase64 || image;
      if (rawImage.startsWith("data:application/pdf")) {
        const rawBase64 = rawImage.replace(/^data:application\/pdf;base64,/, "");
        inputBuffer = Buffer.from(rawBase64, "base64");
        inputSizeBytes = inputBuffer.length;
      } else {
        inlineImageUrl = normalizeImageUrl(rawImage);
        inputSizeBytes = Buffer.byteLength(rawImage);
      }
    }

    // Require either PDF/Image buffer or text input
    if (!inputBuffer && !inlineImageUrl && !rawText) {
      metrics.endRequest();
      return res.status(400).json({
        success: false,
        error:
          "Missing required input. Provide 'file' (FormData), 'pdfBase64', 'pdfPath', or 'text'.",
      });
    }

    // 2. Branch: PDF Document Processing (Lazy On-Demand Rendering)
    if (inputBuffer && (isPdfBuffer(inputBuffer) || inputPath?.toLowerCase().endsWith(".pdf"))) {
      const doc = openPdfDocument(inputBuffer);
      const totalPages = validatePdfDocument(doc, MAX_PAGES_LIMIT);
      const jobConcurrency = Math.max(
        1,
        parseInt(concurrency, 10) || DEFAULT_JOB_CONCURRENCY
      );

      logger.info(
        `Processing PDF: ${totalPages} page(s) | Size: ${(inputSizeBytes / 1024).toFixed(1)} KB | Workers: ${jobConcurrency} | Model: ${selectedModel}`
      );

      // Create page indices array [0, 1, 2, ..., totalPages - 1]
      const pageIndices = Array.from({ length: totalPages }, (_, i) => i);

      // Process via Global Scheduler (Interleaved, gated by 8-slot pool)
      const pageResults = await scheduler.processJob(
        pageIndices,
        jobConcurrency,
        async (pageIdx) => {
          const pageStart = Date.now();
          logger.info(`[Page ${pageIdx + 1}/${totalPages}] Rendering & processing...`);

          // LAZY ON-DEMAND RENDERING:
          // Render ONLY this page into PNG, send to DeepSeek, then discard buffer
          const pageDataUrl = renderPageToDataUrl(doc, pageIdx, scale);

          const result = await extractSinglePage(
            pageDataUrl,
            pageIdx,
            systemPrompt,
            selectedModel,
            {
              thinking,
              reasoning_effort,
              rawText,
            }
          );

          const pageDuration = ((Date.now() - pageStart) / 1000).toFixed(2);
          const batchTag = result.data?.batchNumber
            ? ` (Batch #${result.data.batchNumber})`
            : "";
          logger.info(
            `[Page ${pageIdx + 1}/${totalPages}] Done in ${pageDuration}s${batchTag}`
          );

          return result;
        }
      );

      // Extract results and aggregate tokens
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

      const totalDurationSec = (Date.now() - startTime) / 1000;
      const detectedPlant = combinedReports[0]?.plantName || "RMC Plant";

      // Record operational telemetry
      metrics.recordJob({
        fileSizeKB: inputSizeBytes / 1024,
        pageCount: totalPages,
        durationSec: totalDurationSec,
        promptTokens: totalUsage.prompt_tokens,
        completionTokens: totalUsage.completion_tokens,
        success: combinedReports.length > 0,
        plantName: detectedPlant,
      });

      logger.telemetry("JOB_COMPLETED", {
        pages: totalPages,
        reports: combinedReports.length,
        durationSec: Number(totalDurationSec.toFixed(2)),
        tokens: totalUsage.total_tokens,
        plant: detectedPlant,
      });

      metrics.endRequest();

      // Lean response payload (single object if 1 page, array if multi-page)
      const responsePayload = {
        success: combinedReports.length > 0,
        isPdf: true,
        pageCount: totalPages,
        totalReports: combinedReports.length,
        data: totalPages === 1 ? combinedReports[0] || null : combinedReports,
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

    // 3. Branch: Single Static Image File / URL
    if (inlineImageUrl || (inputBuffer && !isPdfBuffer(inputBuffer))) {
      logger.info(`Processing single static image with model: ${selectedModel}`);
      const imageUrl = inlineImageUrl || `data:image/jpeg;base64,${inputBuffer.toString("base64")}`;

      const singleResult = await scheduler.execute(() =>
        extractSinglePage(imageUrl, 0, systemPrompt, selectedModel, {
          thinking,
          reasoning_effort,
          rawText,
        })
      );

      const totalDurationSec = (Date.now() - startTime) / 1000;
      const detectedPlant = singleResult.data?.plantName || "RMC Plant";

      metrics.recordJob({
        fileSizeKB: inputSizeBytes / 1024,
        pageCount: 1,
        durationSec: totalDurationSec,
        promptTokens: singleResult.usage?.prompt_tokens || 0,
        completionTokens: singleResult.usage?.completion_tokens || 0,
        success: singleResult.success,
        plantName: detectedPlant,
      });

      metrics.endRequest();

      const responsePayload = {
        success: singleResult.success,
        isPdf: false,
        pageCount: 1,
        totalReports: singleResult.data ? 1 : 0,
        data: singleResult.data,
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

    // 4. Branch: Text-Only Input
    logger.info(`Processing text-only input with model: ${selectedModel}`);
    const completionParams = {
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: rawText },
      ],
      thinking: thinking !== undefined ? thinking : { type: "disabled" },
      stream: false,
    };

    if (reasoning_effort !== undefined) {
      completionParams.reasoning_effort = reasoning_effort;
    }

    const completion = await scheduler.execute(() =>
      openai.chat.completions.create(completionParams)
    );

    const messageContent = completion.choices[0]?.message?.content || "";
    const parsedData = extractJsonFromContent(messageContent);
    const totalDurationSec = (Date.now() - startTime) / 1000;

    metrics.recordJob({
      fileSizeKB: Buffer.byteLength(rawText) / 1024,
      pageCount: 1,
      durationSec: totalDurationSec,
      promptTokens: completion.usage?.prompt_tokens || 0,
      completionTokens: completion.usage?.completion_tokens || 0,
      success: Boolean(parsedData),
      plantName: parsedData?.plantName || "Text Prompt",
    });

    metrics.endRequest();

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
    metrics.endRequest();
    logger.error("Extraction error:", error.message || error);
    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      success: false,
      error:
        error.message || "An error occurred while processing extraction.",
      details: error.response?.data || error.error || null,
    });
  }
});

// Utility endpoint: Convert a PDF to PNG images (preview pages without sending to LLM)
router.post("/api/convert-pdf", uploadMiddleware, (req, res) => {
  try {
    let pdfBuffer = null;
    if (req.file) {
      pdfBuffer = req.file.buffer;
    } else if (req.body.pdfBase64 || req.body.pdf) {
      const rawBase64 = (req.body.pdfBase64 || req.body.pdf).replace(
        /^data:application\/pdf;base64,/,
        ""
      );
      pdfBuffer = Buffer.from(rawBase64, "base64");
    } else if (req.body.pdfPath || req.body.filePath) {
      const targetPath = req.body.pdfPath || req.body.filePath;
      pdfBuffer = fs.readFileSync(path.resolve(process.cwd(), targetPath));
    }

    if (!pdfBuffer) {
      return res.status(400).json({
        success: false,
        error: "No PDF file found. Provide 'file' (FormData) or 'pdfBase64'.",
      });
    }

    const doc = openPdfDocument(pdfBuffer);
    const totalPages = validatePdfDocument(doc, MAX_PAGES_LIMIT);
    const scale = typeof req.body.scale === "number" ? req.body.scale : 2.0;

    const images = [];
    for (let i = 0; i < totalPages; i++) {
      images.push(renderPageToDataUrl(doc, i, scale));
    }

    return res.json({
      success: true,
      pageCount: totalPages,
      images,
    });
  } catch (error) {
    logger.error("PDF conversion error:", error.message);
    return res.status(error.status || 400).json({
      success: false,
      error: error.message || "Failed to convert PDF.",
    });
  }
});

export default router;
