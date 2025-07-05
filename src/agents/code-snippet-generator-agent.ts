import OpenAI from "openai";

import { Logger } from "@/logger";
import { RateLimiter } from "@/rate-limiter";
import { buildOpenAIClientForDataPipeline } from "@/oepnai-client";
import { Env } from "@/env";

export interface CodeSnippet {
  originalContent: string;
  generatedSnippet: string;
  language: string;
  isUnitTest: boolean;
}

export class CodeSnippetGeneratorAgent {
  private openai: OpenAI;

  constructor(
    env: Env,
    private rateLimiter?: RateLimiter,
  ) {
    this.openai = buildOpenAIClientForDataPipeline(env);
  }

  async generateReusableSnippet(
    content: string,
    filePath: string,
  ): Promise<CodeSnippet> {
    try {
      const isUnitTest = this.isUnitTestFile(filePath);
      const language = this.detectLanguage(content, filePath);

      if (
        !isUnitTest &&
        !this.isSDKSourceFile(filePath) &&
        !this.isDocumentationFile(filePath)
      ) {
        return {
          originalContent: content,
          generatedSnippet: content,
          language,
          isUnitTest: false,
        };
      }

      let prompt: string;

      if (isUnitTest) {
        prompt = `You are tasked with generating useful code examples from either unit test code or example code found in OpenAI's official SDK repositories.

If the provided text is unit test code for an SDK, you will create a single script that executes a set of operations tested by the unit test. Focus especially on:
- API parameters and their usage
- Configuration settings and options
- Authentication and initialization patterns
- Error handling examples
- Response format examples

Extract the method executions/invocations of the test target, along with their required initialization processes, such as class instantiation or setting necessary variables. Include detailed comments explaining parameters, settings, and configuration options. Converting the assertions in the test code isn't needed, but if the details of a returned value show parameter effects or settings, include them as comments.

Provide only the generated script code in your response.`;
      } else if (this.isDocumentationFile(filePath)) {
        prompt = `You are an expert at creating clear, practical documentation for developers. Clean up and improve this documentation content to make it more useful for OpenAI API users. Focus on practical examples and clear explanations. Remove any internal implementation details that aren't relevant to end users.

Provide only the improved documentation content in your response.`;
      } else {
        prompt = `You are an expert programmer specializing in OpenAI API integration. Convert this SDK source code into a practical, reusable code example that demonstrates how to use the functionality. Focus especially on:
- API parameters and their effects
- Configuration settings and options
- Authentication patterns
- Error handling approaches
- Input/output examples

Include detailed comments explaining what each parameter does, what settings are available, and how different configurations affect behavior. Provide a complete, working example that developers can use as a reference for understanding parameters and settings.

Provide only the generated example code in your response.`;
      }

      const response = this.rateLimiter
        ? await this.rateLimiter.executeWithRateLimit(() =>
            this.openai.responses.create({
              model: "gpt-4.1-mini",
              instructions: prompt,
              input: content,
              max_output_tokens: 2000,
              temperature: 0.1,
            }),
          )
        : await this.openai.responses.create({
            model: "gpt-4.1-mini",
            instructions: prompt,
            input: content,
            max_output_tokens: 2000,
            temperature: 0.1,
          });

      const generatedSnippet = response.output_text || content;

      Logger.info(
        `Generated ${isUnitTest ? "unit test" : "SDK"} snippet for ${filePath}: ${content.length} -> ${generatedSnippet.length} chars`,
      );

      return {
        originalContent: content,
        generatedSnippet,
        language,
        isUnitTest,
      };
    } catch (error) {
      Logger.error(`Failed to generate snippet for ${filePath}:`, error);
      return {
        originalContent: content,
        generatedSnippet: content,
        language: this.detectLanguage(content, filePath),
        isUnitTest: this.isUnitTestFile(filePath),
      };
    }
  }

  private isUnitTestFile(filePath: string): boolean {
    return (
      /\.(test|spec)\.(js|ts|py)$/i.test(filePath) ||
      /\/tests?\//i.test(filePath) ||
      /__tests__/i.test(filePath)
    );
  }

  private isSDKSourceFile(filePath: string): boolean {
    return (
      /\.(js|ts|py)$/i.test(filePath) &&
      !this.isUnitTestFile(filePath) &&
      !/\.(md|txt|json|yml|yaml)$/i.test(filePath)
    );
  }

  private isDocumentationFile(filePath: string): boolean {
    return (
      /\.md$/i.test(filePath) ||
      /\/docs?\//i.test(filePath) ||
      /\/examples?\//i.test(filePath) ||
      /\/cookbook\//i.test(filePath) ||
      /README/i.test(filePath) ||
      /CHANGELOG/i.test(filePath) ||
      /CONTRIBUTING/i.test(filePath)
    );
  }

  private detectLanguage(content: string, filePath: string): string {
    if (filePath.endsWith(".py")) return "python";
    if (filePath.endsWith(".ts")) return "typescript";
    if (filePath.endsWith(".js")) return "javascript";
    if (filePath.endsWith(".ipynb")) {
      try {
        const notebook = JSON.parse(content);
        return (
          notebook.metadata?.language_info?.name ||
          notebook.metadata?.kernelspec?.language ||
          "python"
        );
      } catch {
        return "python";
      }
    }

    if (/import\s+\w+/g.test(content)) return "python";
    if (/const\s+\w+\s*=/g.test(content)) return "javascript";

    return "text";
  }
}
