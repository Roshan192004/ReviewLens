import { GoogleGenerativeAI } from "@google/generative-ai";
import { CONFIG } from "../config.js";

function providerError(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status ?? 0;
  let retryAfterMs = 0;
  const header = error?.response?.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : 0;
  } else if (typeof error?.retryDelay === "string") {
    const match = error.retryDelay.match(/^([\d.]+)s$/);
    if (match) retryAfterMs = Math.ceil(Number(match[1]) * 1000);
  }

  const message =
    typeof error?.message === "string" && error.message.trim()
      ? error.message
      : "LLM provider request failed";
  const wrapped = new Error(message);
  wrapped.status = status;
  wrapped.retryAfterMs = retryAfterMs;
  return wrapped;
}

export async function complete({ system, user }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("GEMINI_API_KEY is not set");
    error.status = 500;
    error.code = "MISSING_API_KEY";
    error.retryAfterMs = 0;
    throw error;
  }

  try {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: CONFIG.MODEL_NAME,
      systemInstruction: system,
      generationConfig: {
        temperature: CONFIG.TEMPERATURE,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent(user);
    return result.response.text();
  } catch (error) {
    throw providerError(error);
  }
}
