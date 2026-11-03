import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

export const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * Extracts and parses JSON safely from LLM text responses
 */
export function extractJsonFromContent(content) {
  if (!content) return null;
  const trimmed = content.trim();

  // 1. Try direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue
  }

  // 2. Handle markdown code fences (```json ... ``` or ``` ... ```)
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // 3. Find outermost JSON brackets { ... }
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

/**
 * Extracts data from a single image using DeepSeek Vision API
 * Defaults thinking to { type: "disabled" } for sub-4-second extraction
 */
export function createExtractionPayload(imageUrl, systemPrompt, customText = null) {
  return [
    {
      type: "text",
      text:
        customText ||
        "Extract structured data from this batch report according to the system instructions.",
    },
    {
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    },
  ];
}

export async function extractSinglePage(
  imageUrl,
  pageIndex,
  systemPrompt,
  selectedModel,
  options = {}
) {
  const userMessageContent = createExtractionPayload(
    imageUrl,
    systemPrompt,
    options.rawText
  );

  const completionParams = {
    model: selectedModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessageContent },
    ],
    // Turn off thinking tokens by default for instant 3s extraction
    thinking: options.thinking !== undefined ? options.thinking : { type: "disabled" },
    stream: false,
  };

  if (options.reasoning_effort !== undefined) {
    completionParams.reasoning_effort = options.reasoning_effort;
  }

  const completion = await openai.chat.completions.create(completionParams);
  const messageContent = completion.choices[0]?.message?.content || "";
  const parsedData = extractJsonFromContent(messageContent);

  return {
    page: pageIndex + 1,
    success: Boolean(parsedData),
    data: parsedData,
    raw: messageContent,
    usage: completion.usage || null,
  };
}
