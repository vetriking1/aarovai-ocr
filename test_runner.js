import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_URL = "http://localhost:3000/api/extract";
const testImages = ["testimg1.jpeg", "test_img2.jpeg"];

async function runTest() {
  console.log("Starting tests for test images...");

  for (const imgName of testImages) {
    const imgPath = path.join(__dirname, "test_images", imgName);
    console.log(`\n========================================`);
    console.log(`Testing image: ${imgName}`);
    console.log(`Path: ${imgPath}`);
    console.log(`========================================`);

    try {
      const response = await fetch(SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imagePath: imgPath,
        }),
      });

      const result = await response.json();
      console.log(`HTTP Status: ${response.status}`);
      console.log(`Result:`, JSON.stringify(result, null, 2));

      // Save output to JSON file for review
      const outPath = path.join(__dirname, `output_${imgName}.json`);
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(`Saved result to: ${outPath}`);
    } catch (err) {
      console.error(`Error testing ${imgName}:`, err.message);
    }
  }
}

runTest();
