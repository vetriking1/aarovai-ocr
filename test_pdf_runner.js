import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3050/api/extract";
const TEST_PDF_DIR = path.join(__dirname, "test_pdf");

async function runPdfTests() {
  if (!fs.existsSync(TEST_PDF_DIR)) {
    console.error(`Directory not found: ${TEST_PDF_DIR}`);
    return;
  }

  const pdfFiles = fs
    .readdirSync(TEST_PDF_DIR)
    .filter((file) => file.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log("No PDF files found in test_pdf directory.");
    return;
  }

  console.log(`Found ${pdfFiles.length} PDF(s) in ${TEST_PDF_DIR}`);

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(TEST_PDF_DIR, pdfFile);
    console.log(`\n========================================`);
    console.log(`Testing PDF: ${pdfFile}`);
    console.log(`Path: ${pdfPath}`);
    console.log(`========================================`);

    try {
      const response = await fetch(SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfPath: pdfPath,
        }),
      });

      const result = await response.json();
      console.log(`HTTP Status: ${response.status}`);
      console.log(`Pages Processed: ${result.pageCount || 1}`);
      console.log(`Reports Extracted: ${result.totalReports || (result.data ? 1 : 0)}`);
      console.log(`Result:`, JSON.stringify(result, null, 2));

      // Save output to JSON file for review
      const outPath = path.join(__dirname, `output_${pdfFile}.json`);
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(`Saved result to: ${outPath}`);
    } catch (err) {
      console.error(`Error testing ${pdfFile}:`, err.message);
    }
  }
}

runPdfTests();
