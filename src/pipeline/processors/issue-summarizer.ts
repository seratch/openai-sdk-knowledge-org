import OpenAI from "openai";

import { Logger } from "@/logger";
import type { GitHubIssue } from "@/pipeline/collectors/github";
import { RateLimiter } from "@/rate-limiter";
import { buildOpenAIClientForDataPipeline } from "@/oepnai-client";
import { Env } from "@/env";

export interface IssueSummary {
  title: string;
  summary: string;
  originalLength: number;
  summaryLength: number;
}

export class IssueSummarizerImpl {
  private openai: OpenAI;

  constructor(
    env: Env,
    private rateLimiter?: RateLimiter,
  ) {
    this.openai = buildOpenAIClientForDataPipeline(env);
  }

  async summarizeIssue(issue: GitHubIssue): Promise<IssueSummary | null> {
    try {
      if (!(await this.hasUsefulSolutionWithAI(issue))) {
        Logger.lazyDebug(
          () =>
            `Skipping issue #${issue.number}: no useful solution or conclusion (AI + rule-based assessment)`,
        );
        return null;
      }

      const fullConversation = this.buildFullConversation(issue);

      if (fullConversation.length < 500) {
        return {
          title: issue.title,
          summary: fullConversation,
          originalLength: fullConversation.length,
          summaryLength: fullConversation.length,
        };
      }

      const prompt = `You'll be responsible for summarizing a GitHub issue, ensuring all crucial details from the discussion are preserved. You may exclude irrelevant parts such as template phrases, OS/runtime version information, and system-specific details that don't help with API usage.

Focus on API usage patterns, code examples, and solutions. Exclude details about:
- Operating system versions (Windows, macOS, Linux)
- Runtime versions (Node.js, Python versions)
- System-specific configurations
- Hardware specifications

Maintain any working code examples in the summary. Include any mentioned error messages or codes. If there are valuable links to official documentation, those should also be part of the summary.

Provide only the summary in your response.`;

      const response = this.rateLimiter
        ? await this.rateLimiter.executeWithRateLimit(() =>
            this.openai.responses.create({
              model: "gpt-4.1-mini",
              instructions: prompt,
              input: fullConversation,
              max_output_tokens: 2000,
              temperature: 0.1,
            }),
          )
        : await this.openai.responses.create({
            model: "gpt-4.1-mini",
            instructions: prompt,
            input: fullConversation,
            max_output_tokens: 2000,
            temperature: 0.1,
          });

      const summary = response.output_text || fullConversation;

      Logger.info(
        `Summarized issue #${issue.number}: ${fullConversation.length} -> ${summary.length} chars`,
      );

      return {
        title: issue.title,
        summary,
        originalLength: fullConversation.length,
        summaryLength: summary.length,
      };
    } catch (error) {
      Logger.error(`Failed to summarize issue #${issue.number}:`, error);
      const fallback = this.buildFullConversation(issue);
      return {
        title: issue.title,
        summary: fallback,
        originalLength: fallback.length,
        summaryLength: fallback.length,
      };
    }
  }

  private buildFullConversation(issue: GitHubIssue): string {
    let conversation = `Title: ${issue.title}\n\n${issue.body}`;

    if (issue.comments && issue.comments.length > 0) {
      conversation += "\n\nComments:\n";
      for (const comment of issue.comments) {
        conversation += `\n${comment.author}: ${comment.body}\n`;
      }
    }

    return conversation;
  }

  private hasUsefulSolution(issue: GitHubIssue): boolean {
    const isClosed = issue.state === "closed";
    const hasComments = issue.comments && issue.comments.length > 0;
    const hasSubstantialContent = issue.body && issue.body.length > 200;
    const hasEngagement = hasComments || issue.labels.length > 0;

    const fullText =
      `${issue.title} ${issue.body || ""} ${issue.comments?.map((c) => c.body).join(" ") || ""}`.toLowerCase();
    const hasSolutionIndicators =
      /\b(solved|fixed|resolved|solution|answer|working|thanks|helped|workaround)\b/.test(
        fullText,
      );
    const hasCodeExamples =
      /```|`[^`]+`|\bcode\b|\bexample\b|\bapi\b|\bparameter\b|\bsetting\b/.test(
        fullText,
      );

    const isBugReport = /\b(bug|error|issue|problem|broken|fail|crash)\b/.test(
      fullText,
    );

    if (isBugReport && !hasSolutionIndicators && !hasCodeExamples) {
      return false;
    }

    if (!isClosed && !hasSolutionIndicators && !hasCodeExamples) {
      return false;
    }

    const passesRuleBasedFilter = Boolean(
      hasSubstantialContent &&
        ((isClosed && hasSolutionIndicators) ||
          hasCodeExamples ||
          (hasEngagement && fullText.length > 500 && hasSolutionIndicators)),
    );

    return passesRuleBasedFilter;
  }

  async hasUsefulSolutionWithAI(issue: GitHubIssue): Promise<boolean> {
    try {
      if (!this.hasUsefulSolution(issue)) {
        return false;
      }

      const fullConversation = this.buildFullConversation(issue);

      if (fullConversation.length < 300) {
        return this.hasUsefulSolution(issue);
      }

      const assessmentPrompt = `You are evaluating whether a GitHub issue discussion contains useful information for developers using OpenAI APIs and SDKs.

Evaluate this issue and respond with only "USEFUL" or "NOT_USEFUL" based on these criteria:

USEFUL if the issue contains:
- Working code examples or API usage patterns
- Solutions to common API integration problems
- Explanations of API parameters, responses, or behavior
- Workarounds for known issues
- Clear error resolution steps
- Best practices for API usage

NOT_USEFUL if the issue:
- Only reports bugs without solutions or workarounds
- Contains mostly system-specific details (OS, versions) without API insights
- Is primarily feature requests without implementation guidance
- Has no actionable information for API users
- Is mostly complaints or discussions without technical content

Respond with only "USEFUL" or "NOT_USEFUL".`;

      const response = this.rateLimiter
        ? await this.rateLimiter.executeWithRateLimit(() =>
            this.openai.responses.create({
              model: "gpt-4.1-mini",
              instructions: assessmentPrompt,
              input: fullConversation.slice(0, 4000),
              max_output_tokens: 16,
              temperature: 0.1,
            }),
          )
        : await this.openai.responses.create({
            model: "gpt-4.1-mini",
            instructions: assessmentPrompt,
            input: fullConversation.slice(0, 4000),
            max_output_tokens: 16,
            temperature: 0.1,
          });

      const assessment = response.output_text?.trim().toUpperCase();
      const isUseful = assessment === "USEFUL";

      Logger.lazyDebug(
        () =>
          `AI assessment for issue #${issue.number}: ${assessment} (rule-based: ${this.hasUsefulSolution(issue)})`,
      );

      return isUseful;
    } catch (error) {
      Logger.warn(
        `Failed to get AI assessment for issue #${issue.number}, falling back to rule-based filtering:`,
        error,
      );
      return this.hasUsefulSolution(issue);
    }
  }
}
