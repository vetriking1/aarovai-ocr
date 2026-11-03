/**
 * In-memory telemetry & operational metrics tracker (Tier 1 Zero-RAM visualizer)
 */
class MetricsTracker {
  constructor() {
    this.activeRequests = 0;
    this.peakConcurrentRequests = 0;
    this.totalJobs = 0;
    this.totalSuccessJobs = 0;
    this.totalFailedJobs = 0;
    this.totalPages = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalDurationSec = 0;
    this.recentJobs = []; // Stores last 50 jobs for the dashboard charts
    this.hourlyDistribution = {}; // Tracks requests by hour "YYYY-MM-DD HH:00"
  }

  startRequest() {
    this.activeRequests++;
    if (this.activeRequests > this.peakConcurrentRequests) {
      this.peakConcurrentRequests = this.activeRequests;
    }
    return this.activeRequests;
  }

  endRequest() {
    if (this.activeRequests > 0) {
      this.activeRequests--;
    }
    return this.activeRequests;
  }

  recordJob({
    fileSizeKB = 0,
    pageCount = 1,
    durationSec = 0,
    promptTokens = 0,
    completionTokens = 0,
    success = true,
    error = null,
    plantName = "Unknown",
  }) {
    this.totalJobs++;
    if (success) {
      this.totalSuccessJobs++;
    } else {
      this.totalFailedJobs++;
    }

    this.totalPages += pageCount;
    this.totalPromptTokens += promptTokens;
    this.totalCompletionTokens += completionTokens;
    this.totalDurationSec += durationSec;

    // Track hourly volume
    const hourKey = new Date().toISOString().substring(0, 13) + ":00";
    this.hourlyDistribution[hourKey] = (this.hourlyDistribution[hourKey] || 0) + pageCount;

    // Keep last 50 jobs for live dashboard
    const jobRecord = {
      id: this.totalJobs,
      timestamp: new Date().toISOString(),
      fileSizeKB: Math.round(fileSizeKB),
      pageCount,
      durationSec: Number(durationSec.toFixed(2)),
      avgSecPerPage: Number((durationSec / (pageCount || 1)).toFixed(2)),
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      plantName,
      success,
      error,
    };

    this.recentJobs.unshift(jobRecord);
    if (this.recentJobs.length > 50) {
      this.recentJobs.pop();
    }
  }

  getSnapshot() {
    const memory = process.memoryUsage();
    const avgDuration =
      this.totalJobs > 0 ? (this.totalDurationSec / this.totalJobs).toFixed(2) : "0.00";

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      activeRequests: this.activeRequests,
      peakConcurrentRequests: this.peakConcurrentRequests,
      totalJobs: this.totalJobs,
      totalSuccessJobs: this.totalSuccessJobs,
      totalFailedJobs: this.totalFailedJobs,
      totalPagesProcessed: this.totalPages,
      averageJobDurationSec: Number(avgDuration),
      tokens: {
        prompt: this.totalPromptTokens,
        completion: this.totalCompletionTokens,
        total: this.totalPromptTokens + this.totalCompletionTokens,
      },
      memory: {
        rssMB: Number((memory.rss / (1024 * 1024)).toFixed(1)),
        heapUsedMB: Number((memory.heapUsed / (1024 * 1024)).toFixed(1)),
        heapTotalMB: Number((memory.heapTotal / (1024 * 1024)).toFixed(1)),
      },
      recentJobs: this.recentJobs,
      hourlyDistribution: this.hourlyDistribution,
    };
  }
}

export const metrics = new MetricsTracker();
