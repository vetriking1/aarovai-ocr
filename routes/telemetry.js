import express from "express";
import { metrics } from "../lib/metrics.js";
import { scheduler } from "../lib/scheduler.js";

const router = express.Router();

// Real-time metrics JSON snapshot
router.get("/api/metrics", (req, res) => {
  const snapshot = metrics.getSnapshot();
  // Include live scheduler slot status
  snapshot.activeSchedulerSlots = scheduler.activeCount;
  snapshot.maxSchedulerSlots = scheduler.maxSlots;
  res.json(snapshot);
});

// Tier 1: Zero-RAM Embedded Visualizer Dashboard
router.get("/dashboard", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OCR Telemetry Dashboard | Aarov RMC</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { background-color: #0b0f19; color: #e2e8f0; }
        .card { background-color: #151c2c; border: 1px solid #1e293b; border-radius: 12px; }
      </style>
    </head>
    <body class="p-4 sm:p-6 lg:p-8">
      <div class="max-w-7xl mx-auto space-y-6">
        
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div class="flex items-center gap-3">
              <h1 class="text-2xl font-bold text-white tracking-tight">Aarov OCR Live Telemetry</h1>
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1.5"></span> Live Synced
              </span>
            </div>
            <p class="text-sm text-slate-400 mt-1">Real-time performance, concurrency, token usage, and RAM vitals.</p>
          </div>
          <div class="text-xs text-slate-400 font-mono bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            Auto-refresh: <span class="text-indigo-400">3s</span> | Server Port: <span class="text-indigo-400">3050</span>
          </div>
        </div>

        <!-- Metric Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div class="card p-4">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Concurrency</span>
            <div class="text-2xl font-bold text-indigo-400 mt-1" id="val-active">0</div>
            <span class="text-xs text-slate-500 mt-1 block">Peak concurrent: <strong id="val-peak" class="text-slate-300">0</strong></span>
          </div>

          <div class="card p-4">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Global Slots</span>
            <div class="text-2xl font-bold text-purple-400 mt-1" id="val-slots">0 / 8</div>
            <span class="text-xs text-slate-500 mt-1 block">DeepSeek rate shield</span>
          </div>

          <div class="card p-4">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Batches Extracted</span>
            <div class="text-2xl font-bold text-emerald-400 mt-1" id="val-jobs">0</div>
            <span class="text-xs text-slate-500 mt-1 block">Pages: <strong id="val-pages" class="text-slate-300">0</strong></span>
          </div>

          <div class="card p-4">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Latency / Job</span>
            <div class="text-2xl font-bold text-amber-400 mt-1" id="val-latency">0.0s</div>
            <span class="text-xs text-slate-500 mt-1 block">Sub-4s target</span>
          </div>

          <div class="card p-4">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Server Memory (RSS)</span>
            <div class="text-2xl font-bold text-cyan-400 mt-1" id="val-ram">0 MB</div>
            <span class="text-xs text-slate-500 mt-1 block">Heap: <strong id="val-heap" class="text-slate-300">0 MB</strong> / 4GB</span>
          </div>
        </div>

        <!-- Charts Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Latency Chart -->
          <div class="card p-5">
            <h3 class="text-sm font-semibold text-slate-300 mb-4 flex items-center justify-between">
              <span>Extraction Latency History (Last 50 Jobs)</span>
              <span class="text-xs font-normal text-slate-500">Seconds</span>
            </h3>
            <div class="h-64">
              <canvas id="chart-latency"></canvas>
            </div>
          </div>

          <!-- Tokens & Pages Chart -->
          <div class="card p-5">
            <h3 class="text-sm font-semibold text-slate-300 mb-4 flex items-center justify-between">
              <span>Token Consumption Trend</span>
              <span class="text-xs font-normal text-slate-500">Total Tokens</span>
            </h3>
            <div class="h-64">
              <canvas id="chart-tokens"></canvas>
            </div>
          </div>
        </div>

        <!-- Recent Jobs Feed Table -->
        <div class="card overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-200">Live Job Execution Feed</h3>
            <span class="text-xs text-slate-400">Updates live without page reload</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900/60 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">Time</th>
                  <th class="px-4 py-3">Plant</th>
                  <th class="px-4 py-3">File Size</th>
                  <th class="px-4 py-3">Pages</th>
                  <th class="px-4 py-3">Total Time</th>
                  <th class="px-4 py-3">Avg / Page</th>
                  <th class="px-4 py-3">Tokens</th>
                  <th class="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody id="feed-body" class="divide-y divide-slate-800 text-slate-300 font-mono">
                <tr>
                  <td colspan="8" class="px-4 py-8 text-center text-slate-500">Awaiting incoming OCR extraction requests...</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <script>
        let latencyChart = null;
        let tokensChart = null;

        function initCharts() {
          const ctxLatency = document.getElementById('chart-latency').getContext('2d');
          latencyChart = new Chart(ctxLatency, {
            type: 'line',
            data: {
              labels: [],
              datasets: [{
                label: 'Duration (s)',
                data: [],
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#818cf8'
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { display: false },
                y: {
                  grid: { color: '#1e293b' },
                  ticks: { color: '#64748b', font: { size: 10 } },
                  beginAtZero: true
                }
              }
            }
          });

          const ctxTokens = document.getElementById('chart-tokens').getContext('2d');
          tokensChart = new Chart(ctxTokens, {
            type: 'bar',
            data: {
              labels: [],
              datasets: [
                {
                  label: 'Prompt Tokens',
                  data: [],
                  backgroundColor: '#3b82f6'
                },
                {
                  label: 'Completion Tokens',
                  data: [],
                  backgroundColor: '#10b981'
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  labels: { color: '#94a3b8', font: { size: 11 } }
                }
              },
              scales: {
                x: { display: false, stacked: true },
                y: {
                  grid: { color: '#1e293b' },
                  ticks: { color: '#64748b', font: { size: 10 } },
                  stacked: true,
                  beginAtZero: true
                }
              }
            }
          });
        }

        async function updateDashboard() {
          try {
            const res = await fetch('/api/metrics');
            if (!res.ok) return;
            const data = await res.json();

            // Update top cards
            document.getElementById('val-active').textContent = data.activeRequests;
            document.getElementById('val-peak').textContent = data.peakConcurrentRequests;
            document.getElementById('val-slots').textContent = (data.activeSchedulerSlots || 0) + ' / ' + (data.maxSchedulerSlots || 8);
            document.getElementById('val-jobs').textContent = data.totalJobs;
            document.getElementById('val-pages').textContent = data.totalPagesProcessed;
            document.getElementById('val-latency').textContent = data.averageJobDurationSec + 's';
            document.getElementById('val-ram').textContent = data.memory.rssMB + ' MB';
            document.getElementById('val-heap').textContent = data.memory.heapUsedMB + ' MB';

            // Update charts with recent jobs (reverse to show chronological)
            const recent = (data.recentJobs || []).slice().reverse();
            if (recent.length > 0) {
              const labels = recent.map(j => '#' + j.id);
              const durations = recent.map(j => j.durationSec);
              const promptTokens = recent.map(j => j.tokens.prompt);
              const completionTokens = recent.map(j => j.tokens.completion);

              latencyChart.data.labels = labels;
              latencyChart.data.datasets[0].data = durations;
              latencyChart.update('none');

              tokensChart.data.labels = labels;
              tokensChart.data.datasets[0].data = promptTokens;
              tokensChart.data.datasets[1].data = completionTokens;
              tokensChart.update('none');

              // Update feed table
              const tbody = document.getElementById('feed-body');
              tbody.innerHTML = (data.recentJobs || []).map(j => {
                const timeStr = j.timestamp.substring(11, 19);
                const badge = j.success
                  ? '<span class="text-emerald-400 font-semibold">200 OK</span>'
                  : '<span class="text-red-400 font-semibold">FAIL</span>';
                return '<tr>' +
                  '<td class="px-4 py-2.5 text-slate-400">' + timeStr + '</td>' +
                  '<td class="px-4 py-2.5 text-indigo-300 font-medium">' + j.plantName + '</td>' +
                  '<td class="px-4 py-2.5">' + j.fileSizeKB + ' KB</td>' +
                  '<td class="px-4 py-2.5">' + j.pageCount + '</td>' +
                  '<td class="px-4 py-2.5 font-semibold text-slate-200">' + j.durationSec + 's</td>' +
                  '<td class="px-4 py-2.5 text-slate-400">' + j.avgSecPerPage + 's</td>' +
                  '<td class="px-4 py-2.5 text-slate-300">' + j.tokens.total.toLocaleString() + '</td>' +
                  '<td class="px-4 py-2.5">' + badge + '</td>' +
                  '</tr>';
              }).join('');
            }
          } catch (err) {
            console.error('Failed to update telemetry:', err);
          }
        }

        window.addEventListener('DOMContentLoaded', () => {
          initCharts();
          updateDashboard();
          setInterval(updateDashboard, 3000);
        });
      </script>
    </body>
    </html>
  `);
});

export default router;
