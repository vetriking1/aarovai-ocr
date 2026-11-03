/**
 * Structured logger with ISO/local timestamps (PM2 friendly)
 */
export const logger = {
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
  telemetry(event, data) {
    console.log(
      `[${this.getTimestamp()}] [TELEMETRY] ${event} | ${JSON.stringify(data)}`
    );
  },
};

/**
 * Express middleware for logging incoming requests & response times
 */
export function requestLoggerMiddleware(req, res, next) {
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
}
