# Indian GST Invoice Data Extraction Server (Express.js + DeepSeek)

An Express.js API server utilizing the DeepSeek API (via OpenAI Node SDK) and [prompt.txt](file:///D:/WEB_DEV/Arov/AarovApp/ocr-ai/prompt.txt) to extract structured JSON data from Indian GST invoices (both text and images).

---

## 1. Setup

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
In [.env](file:///D:/WEB_DEV/Arov/AarovApp/ocr-ai/.env):
```env
PORT=3000
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-flash
```

---

## 2. Running the Server

### Development Mode (auto-reloads on file change)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

Server runs on `http://localhost:3000`.

---

## 3. API Endpoints

### `POST /api/extract`
Extracts structured invoice JSON from text, local image path, or base64 image.

#### Option A: Local Image Path
```json
{
  "imagePath": "test_images/testimg1.jpeg"
}
```

#### Option B: Base64 / Data URL
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

#### Option C: Plain Text / OCR Text
```json
{
  "text": "TAX INVOICE\nSupplier: TechCorp Solutions Pvt Ltd\nGSTIN: 27AABCT1234F1Z5..."
}
```

#### Response Structure
```json
{
  "success": true,
  "data": {
    "supplier": {
      "name": "CHETTINAD CEMENT CORPORATION PRIVATE LIMITED",
      "gstin": "37AAACC3130A1Z1",
      "address": "Dachepalli Mandal, Pedagarilapadu Village, Guntur, Andhra Pradesh, 522431",
      "state": "Andhra Pradesh",
      "stateCode": "37"
    },
    "invoice": {
      "invoiceNumber": "DW20177893",
      "invoiceDate": "2026-09-07",
      "poNumber": "1",
      "placeOfSupply": "33 - Tamil Nadu",
      "vehicleNumber": "TN01BR8326"
    },
    "lineItems": [ ... ],
    "taxSummary": { ... }
  },
  "raw": "...",
  "usage": { ... }
}
```

---

## 4. Run Test Script
To test all images in the `test_images/` directory:
```bash
node test_runner.js
```
The test outputs are saved as `output_<filename>.json`.
