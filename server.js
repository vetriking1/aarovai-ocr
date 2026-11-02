import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables from .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPT_FILE_PATH = path.join(__dirname, "prompt.txt");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware (allow large payloads for base64 images)
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize OpenAI client with DeepSeek baseURL
const openai = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * Reads system prompt from prompt.txt dynamically
 */
function getSystemPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE_PATH)) {
      return fs.readFileSync(PROMPT_FILE_PATH, "utf-8").trim();
    }
  } catch (err) {
    console.error("Error reading prompt.txt:", err.message);
  }
  return "You are an expert invoice data extraction AI. Extract structured data from Indian GST invoices. Return ONLY valid JSON, no markdown or explanation.";
}

/**
 * Converts a file path to base64 data URL
 */
function fileToDataUrl(filePath) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
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
  if (trimmed.startsWith("data:") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  // Assume raw base64 jpeg by default
  return `data:image/jpeg;base64,${trimmed}`;
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
  });
});

// View current system prompt
app.get("/api/prompt", (req, res) => {
  res.json({ prompt: getSystemPrompt() });
});

// Primary extraction endpoint (supports both text and images)
app.post("/api/extract", async (req, res) => {
  try {
    const {
      text,
      invoiceText,
      content,
      image,
      imageBase64,
      imagePath,
      model,
      prompt,
      thinking,
      reasoning_effort,
    } = req.body;

    const rawText = text || invoiceText || content;

    // Resolve image URL if provided
    let finalImageUrl = null;
    if (imagePath) {
      finalImageUrl = fileToDataUrl(imagePath);
    } else if (image || imageBase64) {
      finalImageUrl = normalizeImageUrl(image || imageBase64);
    }

    // Require either image or text input
    if (!rawText && !finalImageUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing required input. Provide 'image', 'imageBase64', 'imagePath', or 'text' in the request body.",
      });
    }

    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here") {
      return res.status(500).json({
        success: false,
        error: "DEEPSEEK_API_KEY is not configured in .env file.",
      });
    }

    const systemPrompt = prompt || getSystemPrompt();
    const selectedModel = model || process.env.DEEPSEEK_MODEL || "deepseek-flash";

    // Build user message content based on input type
    let userMessageContent;
    if (finalImageUrl) {
      userMessageContent = [
        {
          type: "text",
          text: rawText || "Extract structured data from this Indian GST invoice according to the system instructions.",
        },
        {
          type: "image_url",
          image_url: {
            url: finalImageUrl,
          },
        },
      ];
    } else {
      userMessageContent = rawText;
    }

    const completionParams = {
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessageContent },
      ],
      stream: false,
    };

    if (thinking !== undefined) {
      completionParams.thinking = thinking;
    }
    if (reasoning_effort !== undefined) {
      completionParams.reasoning_effort = reasoning_effort;
    }

    console.log(`Processing invoice extraction with model: ${selectedModel} (Image: ${Boolean(finalImageUrl)})...`);

    const completion = await openai.chat.completions.create(completionParams);

    const messageContent = completion.choices[0]?.message?.content || "";
    const parsedData = extractJsonFromContent(messageContent);

    return res.json({
      success: true,
      data: parsedData,
      raw: messageContent,
      usage: completion.usage || null,
    });
  } catch (error) {
    console.error("Extraction error:", error);
    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      success: false,
      error: error.message || "An error occurred while processing with DeepSeek.",
      details: error.response?.data || error.error || null,
    });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send(`
    <h2>GST Invoice Data Extraction API</h2>
    <p>Server is running. Supports both text and image invoice extraction via DeepSeek.</p>
    <ul>
      <li><strong>GET /health</strong> - Server health status</li>
      <li><strong>GET /api/prompt</strong> - View loaded system prompt</li>
      <li><strong>POST /api/extract</strong> - Extract structured invoice JSON (accepts <code>image</code>, <code>imagePath</code>, or <code>text</code>)</li>
    </ul>
  `);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`DeepSeek BaseURL: ${openai.baseURL}`);
  console.log(`Prompt file path: ${PROMPT_FILE_PATH}`);
  if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here") {
    console.warn("⚠️  WARNING: DEEPSEEK_API_KEY is not set in .env.");
  } else {
    console.log("DeepSeek API Key is configured.");
  }
});

export default app;
