import OpenAI from "openai";

import { Logger } from "@/logger";
import { buildOpenAIClientForOnlineAccess } from "@/oepnai-client";
import { Env } from "@/env";

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
}

export interface TranslationResult {
  translatedText: string;
  originalLanguage: string;
}

export class TranslatorAgent {
  private openai: OpenAI;

  constructor(env: Env) {
    this.openai = buildOpenAIClientForOnlineAccess(env);
  }

  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    try {
      const response = await this.openai.responses.create({
        model: "gpt-4.1-nano",
        instructions: `You are a language detection expert. Detect the language of the given text and respond with only the language code (e.g., "en" for English, "es" for Spanish, "fr" for French, "ja" for Japanese, "zh" for Chinese, "de" for German, "it" for Italian, "pt" for Portuguese, "ru" for Russian, "ko" for Korean). If the text is already in English, respond with "en".`,
        input: text,
        max_output_tokens: 50,
        temperature: 0,
      });

      const detectedLanguage =
        response.output_text?.trim().toLowerCase() || "en";
      Logger.lazyDebug(
        () =>
          `Detected language: ${detectedLanguage} for text: "${text.substring(0, 50)}..."`,
      );

      return {
        language: detectedLanguage,
        confidence: 0.9,
      };
    } catch (error) {
      Logger.error("Error detecting language:", error);
      return {
        language: "en",
        confidence: 0.1,
      };
    }
  }

  async translateToEnglish(
    text: string,
    sourceLanguage: string,
  ): Promise<string> {
    if (sourceLanguage === "en") {
      return text;
    }

    try {
      const response = await this.openai.responses.create({
        model: "gpt-4.1-mini",
        instructions: `You are a professional translator. Translate the given text to English. Preserve the meaning and intent of the original text. Respond with only the translated text, no additional commentary.`,
        input: `Translate this text from ${sourceLanguage} to English: ${text}`,
        max_output_tokens: 1000,
        temperature: 0.1,
      });

      const translatedText = response.output_text || text;
      Logger.lazyDebug(
        () =>
          `Translated to English: "${text.substring(0, 50)}..." -> "${translatedText.substring(0, 50)}..."`,
      );
      return translatedText;
    } catch (error) {
      Logger.error("Error translating to English:", error);
      return text;
    }
  }

  async translateFromEnglish(
    text: string,
    targetLanguage: string,
  ): Promise<string> {
    if (targetLanguage === "en") {
      return text;
    }

    try {
      const response = await this.openai.responses.create({
        model: "gpt-4.1-mini",
        instructions: `You are a professional translator. Translate the given English text to the specified target language. Preserve the meaning, technical accuracy, and formatting of the original text. Respond with only the translated text, no additional commentary.`,
        input: `Translate this English text to ${targetLanguage}: ${text}`,
        max_output_tokens: 1500,
        temperature: 0.1,
      });

      const translatedText = response.output_text || text;
      Logger.lazyDebug(
        () =>
          `Translated from English to ${targetLanguage}: "${text.substring(0, 50)}..." -> "${translatedText.substring(0, 50)}..."`,
      );
      return translatedText;
    } catch (error) {
      Logger.error(
        `Error translating from English to ${targetLanguage}:`,
        error,
      );
      return text;
    }
  }

  async processQuery(query: string): Promise<TranslationResult> {
    const detection = await this.detectLanguage(query);
    const translatedQuery = await this.translateToEnglish(
      query,
      detection.language,
    );

    return {
      translatedText: translatedQuery,
      originalLanguage: detection.language,
    };
  }

  async processResponse(
    response: string,
    targetLanguage: string,
  ): Promise<string> {
    return await this.translateFromEnglish(response, targetLanguage);
  }
}
