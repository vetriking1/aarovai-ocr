"use client";

import React, { useState, ChangeEvent, DragEvent } from "react";

// ============================================================
// TypeScript Interfaces for RMC Batch Report Data
// ============================================================
export interface TotalActualKg {
  "20MM"?: number;
  SAND?: number;
  SAND1?: number;
  "12MM"?: number;
  CEMENT1?: number;
  CEMENT2?: number;
  FLYASH?: number;
  WATER?: number;
  MS_ICE?: number;
  ADMIX?: number;
  M_FIBER?: number;
  [key: string]: number | undefined;
}

export interface BatchReportItem {
  plantName: string;
  batchDate: string;
  batchStartTime: string;
  batchEndTime: string;
  plantSerialNumber?: string;
  batchNumber: string;
  orderNumber?: string;
  orderedQuantity?: number;
  customer: string;
  productionQuantity: number;
  adjManualQuantity?: number;
  recipeCode?: string;
  recipeName: string;
  withThisLoad?: number;
  mixerCapacity?: number;
  batcherName?: string;
  batchSize?: number;
  truckNumber: string;
  truckDriver?: string | null;
  weighbridgeNetWtKg?: number;
  site: string;
  totalActualKg: TotalActualKg;
}

export interface OcrApiResponse {
  success: boolean;
  isPdf?: boolean;
  pageCount?: number;
  totalReports?: number;
  data: BatchReportItem | BatchReportItem[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: string;
}

// ============================================================
// Main Next.js / React Component
// ============================================================
export default function BatchReportUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<BatchReportItem[]>([]);
  const [pageCount, setPageCount] = useState<number>(0);
  const [selectedReport, setSelectedReport] = useState<BatchReportItem | null>(null);

  // 1. Upload and call Production OCR API using binary multipart/form-data
  const processPdfFile = async (selectedFile: File) => {
    if (!selectedFile) return;

    if (selectedFile.type !== "application/pdf" && !selectedFile.name.endsWith(".pdf")) {
      setError("Please select a valid PDF file.");
      return;
    }

    setFile(selectedFile);
    setIsLoading(true);
    setError(null);
    setReports([]);

    try {
      // Direct binary multipart upload (0% Base64 bloat, 33% faster upload)
      const formData = new FormData();
      formData.append("file", selectedFile);

      // Call Production OCR Endpoint
      const response = await fetch("https://server.aarovbuildmart.in/aiocr/api/extract", {
        method: "POST",
        body: formData, // Browser automatically sets multipart/form-data with boundary
      });

      if (!response.ok) {
        throw new Error(`Server returned status HTTP ${response.status}`);
      }

      const result: OcrApiResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to extract data from the PDF.");
      }

      // Handle both single-page (object) and multi-page (array)
      const parsedReports: BatchReportItem[] = Array.isArray(result.data)
        ? result.data
        : [result.data];

      setReports(parsedReports);
      setPageCount(result.pageCount || parsedReports.length);
    } catch (err: any) {
      console.error("Extraction error:", err);
      setError(err.message || "An unexpected error occurred during extraction.");
    } finally {
      setIsLoading(false);
    }
  };

  // Drag and Drop Handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processPdfFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processPdfFile(e.target.files[0]);
    }
  };

  // Calculate Aggregates
  const totalVolume = reports.reduce((sum, r) => sum + (r.productionQuantity || 0), 0);
  const totalCement = reports.reduce(
    (sum, r) => sum + (r.totalActualKg?.CEMENT1 || 0) + (r.totalActualKg?.CEMENT2 || 0),
    0
  );

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            RMC Batch Report Extractor
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload single or multi-page docket PDFs for instant AI extraction via DeepSeek.
          </p>
        </div>
        {reports.length > 0 && (
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(reports, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `batch_reports_${Date.now()}.json`;
              a.click();
            }}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm transition"
          >
            Export JSON ({reports.length})
          </button>
        )}
      </div>

      {/* Upload Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
          isDragging
            ? "border-indigo-500 bg-indigo-50/50 scale-[1.01]"
            : "border-gray-300 hover:border-gray-400 bg-white"
        }`}
      >
        <input
          type="file"
          id="pdf-input"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleFileChange}
          disabled={isLoading}
        />
        <label htmlFor="pdf-input" className="cursor-pointer block">
          <div className="mx-auto w-12 h-12 text-indigo-600 flex items-center justify-center rounded-full bg-indigo-50 mb-3">
            {isLoading ? (
              <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            )}
          </div>
          <span className="text-sm font-semibold text-gray-700">
            {isLoading ? "Processing PDF..." : "Click to upload or drag & drop"}
          </span>
          <p className="text-xs text-gray-500 mt-1">
            Accepts any single or multi-page RMC Batch Report PDF (up to 50MB)
          </p>
          {file && !isLoading && (
            <p className="text-xs font-medium text-indigo-600 mt-2">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </label>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="font-semibold">Extraction Failed</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Summary Stat Cards */}
      {reports.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs uppercase font-medium text-gray-500">Batches Extracted</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{reports.length} Reports</p>
            <p className="text-xs text-gray-400 mt-1">{pageCount} page(s) scanned</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs uppercase font-medium text-gray-500">Total Volume</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">{totalVolume.toFixed(2)} M³</p>
            <p className="text-xs text-gray-400 mt-1">Ready Mix Concrete</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <p className="text-xs uppercase font-medium text-gray-500">Total Cement Used</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              {totalCement.toLocaleString()} kg
            </p>
            <p className="text-xs text-gray-400 mt-1">CEMENT 1 + CEMENT 2</p>
          </div>
        </div>
      )}

      {/* Extracted Reports Table */}
      {reports.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Extracted Batch Dockets</h3>
            <span className="text-xs bg-emerald-50 text-emerald-700 font-medium px-2.5 py-1 rounded-full">
              Live OCR Synced
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                <tr>
                  <th className="px-4 py-3">Batch #</th>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Plant</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Recipe</th>
                  <th className="px-4 py-3">Truck #</th>
                  <th className="px-4 py-3 text-right">Qty (M³)</th>
                  <th className="px-4 py-3 text-right">Cement (kg)</th>
                  <th className="px-4 py-3 text-right">Admix (kg)</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {reports.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/80 transition">
                    <td className="px-4 py-3 font-semibold text-indigo-600">
                      #{item.batchNumber || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{item.batchDate || "—"}</div>
                      <div className="text-gray-400">
                        {item.batchStartTime} - {item.batchEndTime}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-xs">{item.plantName || "—"}</td>
                    <td className="px-4 py-3 font-medium">{item.customer || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{item.site || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {item.recipeName || item.recipeCode || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">{item.truckNumber || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-indigo-600">
                      {item.productionQuantity?.toFixed(2) || "0.00"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {((item.totalActualKg?.CEMENT1 || 0) + (item.totalActualKg?.CEMENT2 || 0)).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono">
                      {item.totalActualKg?.ADMIX ?? 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setSelectedReport(item)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">
                Batch #{selectedReport.batchNumber} - {selectedReport.customer}
              </h3>
              <button
                onClick={() => setSelectedReport(null)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-400">Plant:</span>{" "}
                <strong className="text-gray-800">{selectedReport.plantName}</strong>
              </div>
              <div>
                <span className="text-gray-400">Truck:</span>{" "}
                <strong className="text-gray-800">{selectedReport.truckNumber}</strong>
              </div>
              <div>
                <span className="text-gray-400">Recipe:</span>{" "}
                <strong className="text-gray-800">{selectedReport.recipeName}</strong>
              </div>
              <div>
                <span className="text-gray-400">Quantity:</span>{" "}
                <strong className="text-gray-800">{selectedReport.productionQuantity} M³</strong>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-xs text-gray-600 uppercase mb-2">
                Actual Material Weights (kg)
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-gray-50 p-3 rounded-lg border">
                {Object.entries(selectedReport.totalActualKg || {}).map(([key, val]) => (
                  <div key={key} className="flex justify-between py-1 border-b border-gray-100">
                    <span className="text-gray-500">{key}:</span>
                    <span className="font-semibold text-gray-800">{val} kg</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <button
                onClick={() => setSelectedReport(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
