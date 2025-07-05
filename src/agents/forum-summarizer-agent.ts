import OpenAI from "openai";

import { Logger } from "@/logger";
import type { TopicDetails } from "@/pipeline/collectors/forum";
import { RateLimiter } from "@/rate-limiter";
import { buildOpenAIClientForDataPipeline } from "@/openai-client";
import { Env } from "@/env";

export interface ForumPostSummary {
  title: string;
  summary: string;
  originalLength: number;
  summaryLength: number;
}

export class ForumPostSummarizerAgent {
  private openai: OpenAI;

  constructor(
    env: Env,
    private rateLimiter?: RateLimiter,
  ) {
    this.openai = buildOpenAIClientForDataPipeline(env);
  }

  async summarizeForumPost(
    topicDetails: TopicDetails,
  ): Promise<ForumPostSummary | null> {
    try {
      if (!(await this.hasUsefulContentWithAI(topicDetails))) {
        Logger.lazyDebug(
          () =>
            `Skipping forum post #${topicDetails.id}: no useful content or solution (AI + rule-based assessment)`,
        );
        return null;
      }

      const fullContent = this.buildFullContent(topicDetails);

      if (fullContent.length < 500) {
        return {
          title: topicDetails.title,
          summary: fullContent,
          originalLength: fullContent.length,
          summaryLength: fullContent.length,
        };
      }

      const prompt = `You'll be responsible for summarizing a forum discussion from the OpenAI community, ensuring all crucial details are preserved. You may exclude irrelevant parts such as off-topic conversations, personal anecdotes, and system-specific details that don't help with API usage.

Focus on API usage patterns, code examples, and solutions. Exclude details about:
- Personal experiences unrelated to API usage
- Off-topic discussions
- System-specific configurations that don't relate to API integration
- Complaints without constructive solutions

Maintain any working code examples in the summary. Include any mentioned error messages or codes. If there are valuable links to official documentation, those should also be part of the summary.

Provide only the summary in your response.`;

      const response = this.rateLimiter
        ? await this.rateLimiter.executeWithRateLimit(() =>
            this.openai.responses.create({
              model: "gpt-4.1-mini",
              instructions: prompt,
              input: fullContent,
              max_output_tokens: 2000,
              temperature: 0.1,
            }),
          )
        : await this.openai.responses.create({
            model: "gpt-4.1-mini",
            instructions: prompt,
            input: fullContent,
            max_output_tokens: 2000,
            temperature: 0.1,
          });

      const summary = response.output_text || fullContent;

      Logger.info(
        `Summarized forum post #${topicDetails.id}: ${fullContent.length} -> ${summary.length} chars`,
      );

      return {
        title: topicDetails.title,
        summary,
        originalLength: fullContent.length,
        summaryLength: summary.length,
      };
    } catch (error) {
      Logger.error(
        `Failed to summarize forum post #${topicDetails.id}:`,
        error,
      );
      const fallback = this.buildFullContent(topicDetails);
      return {
        title: topicDetails.title,
        summary: fallback,
        originalLength: fallback.length,
        summaryLength: fallback.length,
      };
    }
  }

  private buildFullContent(topicDetails: TopicDetails): string {
    let content = `Title: ${topicDetails.title}\n\n`;

    if (topicDetails.posts && topicDetails.posts.length > 0) {
      for (const post of topicDetails.posts) {
        content += `${post.author}: ${post.content}\n\n`;
      }
    }

    return content;
  }

  private hasUsefulContent(topicDetails: TopicDetails): boolean {
    const hasSubstantialContent =
      topicDetails.title && topicDetails.title.length > 10;
    const hasPosts = topicDetails.posts && topicDetails.posts.length > 0;
    const hasEngagement =
      topicDetails.posts &&
      topicDetails.posts.some((p) => p.like_count > 0 || p.reply_count > 0);

    const fullText =
      `${topicDetails.title} ${topicDetails.posts?.map((p) => p.content).join(" ") || ""}`.toLowerCase();
    const hasSolutionIndicators =
      /\b(solved|fixed|resolved|solution|answer|working|thanks|helped|workaround|success)\b/.test(
        fullText,
      );
    const hasCodeExamples =
      /```|`[^`]+`|\bcode\b|\bexample\b|\bapi\b|\bparameter\b|\bsetting\b|\bopenai\b/.test(
        fullText,
      );
    const hasAPIContent =
      /\b(api|sdk|openai|gpt|embedding|completion|chat|model|token)\b/.test(
        fullText,
      );

    const isComplaint =
      /\b(terrible|awful|hate|worst|useless|broken)\b/.test(fullText) &&
      !hasSolutionIndicators;
    const isOffTopic =
      !hasAPIContent && !hasCodeExamples && fullText.length > 200;

    if (isComplaint || isOffTopic) {
      return false;
    }

    const passesRuleBasedFilter = Boolean(
      hasSubstantialContent &&
        hasPosts &&
        (hasSolutionIndicators ||
          hasCodeExamples ||
          hasAPIContent ||
          (hasEngagement && fullText.length > 300)),
    );

    return passesRuleBasedFilter;
  }

  async hasUsefulContentWithAI(topicDetails: TopicDetails): Promise<boolean> {
    try {
      if (!this.hasUsefulContent(topicDetails)) {
        return false;
      }

      const fullContent = this.buildFullContent(topicDetails);

      if (fullContent.length < 300) {
        return this.hasUsefulContent(topicDetails);
      }

      const assessmentPrompt = `You are evaluating whether a forum discussion from the OpenAI community contains useful information for developers using OpenAI APIs and SDKs.

Evaluate this forum post and respond with only "USEFUL" or "NOT_USEFUL" based on these criteria:

USEFUL if the discussion contains:
- Working code examples or API usage patterns
- Solutions to common API integration problems
- Explanations of API parameters, responses, or behavior
- Workarounds for known issues
- Clear error resolution steps
- Best practices for API usage
- Helpful guidance on OpenAI API features
- Technical discussions about API implementation

NOT_USEFUL if the discussion:
- Only contains complaints without solutions or constructive feedback
- Is primarily off-topic conversations unrelated to OpenAI APIs
- Contains mostly personal anecdotes without technical value
- Has no actionable information for API users
- Is mostly feature requests without implementation guidance
- Contains only basic questions without useful answers

Respond with only "USEFUL" or "NOT_USEFUL".`;

      const response = this.rateLimiter
        ? await this.rateLimiter.executeWithRateLimit(() =>
            this.openai.responses.create({
              model: "gpt-4.1-mini",
              instructions: assessmentPrompt,
              input: fullContent.slice(0, 4000),
              max_output_tokens: 16,
              temperature: 0.1,
            }),
          )
        : await this.openai.responses.create({
            model: "gpt-4.1-mini",
            instructions: assessmentPrompt,
            input: fullContent.slice(0, 4000),
            max_output_tokens: 16,
            temperature: 0.1,
          });

      const assessment = response.output_text?.trim().toUpperCase();
      const isUseful = assessment === "USEFUL";

      Logger.lazyDebug(
        () =>
          `AI assessment for forum post #${topicDetails.id}: ${assessment} (rule-based: ${this.hasUsefulContent(topicDetails)})`,
      );

      return isUseful;
    } catch (error) {
      Logger.warn(
        `Failed to get AI assessment for forum post #${topicDetails.id}, falling back to rule-based filtering:`,
        error,
      );
      return this.hasUsefulContent(topicDetails);
    }
  }
}
