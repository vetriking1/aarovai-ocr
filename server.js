import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PORT, PROMPT_FILE_PATH } from "./config/constants.js";
import { logger, requestLoggerMiddleware } from "./lib/logger.js";
import { openai } from "./lib/openai.js";

// Import modular routes
import extractRoutes from "./routes/extract.js";
import telemetryRoutes from "./routes/telemetry.js";
import systemRoutes from "./routes/system.js";

// Load environment variables
dotenv.config();

const app = express();

// Request logging middleware
app.use(requestLoggerMiddleware);

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Mount Modular Routes
app.use(extractRoutes);
app.use(telemetryRoutes);
app.use(systemRoutes);

// Start HTTP server on port (default 3050)
const server = app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT} (PID: ${process.pid})`);
  logger.info(`DeepSeek BaseURL: ${openai.baseURL}`);
  logger.info(`Prompt file path: ${PROMPT_FILE_PATH}`);
  logger.info(`Live Telemetry Dashboard available at: http://localhost:${PORT}/dashboard`);

  if (
    !process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here"
  ) {
    logger.warn("⚠️  WARNING: DEEPSEEK_API_KEY is not configured in .env.");
  } else {
    logger.info("DeepSeek API Key is configured.");
  }
});

// Graceful shutdown handlers (PM2 / Docker / systemd)
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down HTTP server gracefully...`);
  server.close(() => {
    logger.info("HTTP server closed cleanly. Exiting process.");
    process.exit(0);
  });

  // Force shutdown after 10s if active sockets refuse to close
  setTimeout(() => {
    logger.error("Forced exit after shutdown timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

export default app;
