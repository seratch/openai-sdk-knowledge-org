import { createContentModerationGuardrail, createTopicRelevanceGuardrail, POLICY_MESSAGE } from "@/agents/guardrails/input-guardrails";
import { buildOpenAIClientForOnlineAccess } from "@/openai-client";

jest.mock("@/openai-client", () => ({
  buildOpenAIClientForOnlineAccess: jest.fn(),
}));

const mockOpenAI = {
  moderations: {
    create: jest.fn(),
  },
  responses: {
    create: jest.fn(),
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (buildOpenAIClientForOnlineAccess as jest.Mock).mockReturnValue(mockOpenAI);
});

describe("createContentModerationGuardrail", () => {
  it("returns tripwire when content is flagged", async () => {
    mockOpenAI.moderations.create.mockResolvedValue({
      results: [{ flagged: true, categories: { hate: true } }],
    });

    const guardrail = createContentModerationGuardrail("key");
    const result = await guardrail.execute({
      agent: {} as any,
      input: "bad",
      context: {} as any,
    });

    expect(mockOpenAI.moderations.create).toHaveBeenCalledWith({ input: "bad" });
    expect(result).toEqual({
      outputInfo: { reason: "harmful_content", categories: { hate: true } },
      tripwireTriggered: true,
    });
  });

  it("approves content when not flagged", async () => {
    mockOpenAI.moderations.create.mockResolvedValue({
      results: [{ flagged: false }],
    });
    const guardrail = createContentModerationGuardrail("key");
    const result = await guardrail.execute({
      agent: {} as any,
      input: "ok",
      context: {} as any,
    });

    expect(result).toEqual({
      outputInfo: { reason: "content_approved" },
      tripwireTriggered: false,
    });
  });

  it("handles API errors", async () => {
    mockOpenAI.moderations.create.mockRejectedValue(new Error("failure"));
    const guardrail = createContentModerationGuardrail("key");
    const result = await guardrail.execute({
      agent: {} as any,
      input: "err",
      context: {} as any,
    });

    expect(result.outputInfo.reason).toBe("moderation_error");
    expect(result.outputInfo.error).toContain("failure");
    expect(result.tripwireTriggered).toBe(false);
  });
});

describe("createTopicRelevanceGuardrail", () => {
  it("returns tripwire when topic is off", async () => {
    mockOpenAI.responses.create.mockResolvedValue({ output_text: "NO" });

    const guardrail = createTopicRelevanceGuardrail("key");
    const result = await guardrail.execute({
      agent: {} as any,
      input: "topic",
      context: {} as any,
    });

    expect(mockOpenAI.responses.create).toHaveBeenCalled();
    expect(result).toEqual({
      outputInfo: { reason: "off_topic" },
      tripwireTriggered: true,
    });
  });

  it("approves relevant topic", async () => {
    mockOpenAI.responses.create.mockResolvedValue({ output_text: "YES" });
    const guardrail = createTopicRelevanceGuardrail("key");
    const result = await guardrail.execute({
      agent: {} as any,
      input: "topic",
      context: {} as any,
    });

    expect(result).toEqual({
      outputInfo: { reason: "topic_approved" },
      tripwireTriggered: false,
    });
  });

  it("handles API errors", async () => {
    mockOpenAI.responses.create.mockRejectedValue(new Error("boom"));
    const guardrail = createTopicRelevanceGuardrail("key");
    const result = await guardrail.execute({
      agent: {} as any,
      input: "topic",
      context: {} as any,
    });

    expect(result.outputInfo.reason).toBe("topic_check_error");
    expect(result.outputInfo.error).toContain("boom");
    expect(result.tripwireTriggered).toBe(false);
  });
});

describe("POLICY_MESSAGE", () => {
  it("is exported", () => {
    expect(POLICY_MESSAGE).toBeDefined();
  });
});
