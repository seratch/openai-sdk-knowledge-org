import {
  MCPServer,
  TOOL_ANSWER_OPENAI_QUESTIONS,
} from "../../../server/mcp/mcp-server";
import { mockEnv } from "../../utils/mocks";

jest.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock("../../../storage/vector-store", () => ({
  VectorStoreImpl: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue([
      {
        id: "doc1",
        content: "Test documentation content",
        score: 0.9,
        metadata: {},
      },
    ]),
  })),
  getVectorStore: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue([
      {
        id: "doc1",
        content: "Test documentation content",
        score: 0.9,
        metadata: {},
      },
    ]),
  })),
}));

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      responses: {
        create: jest.fn(),
      },
    })),
  };
});

describe("MCPServer", () => {
  let mockServer: any;
  let mockOpenAI: any;

  beforeEach(() => {
    const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
    mockServer = {
      setRequestHandler: jest.fn(),
      connect: jest.fn(),
    };
    Server.mockImplementation(() => mockServer);

    const OpenAI = require("openai").default;
    mockOpenAI = {
      responses: {
        create: jest.fn(),
      },
    };
    OpenAI.mockImplementation(() => mockOpenAI);

    new MCPServer(mockEnv as any);
  });

  it("should initialize server with correct configuration", () => {
    expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
  });

  it("should handle unknown tool error", async () => {
    const callHandler = mockServer.setRequestHandler.mock.calls[1][1];

    await expect(
      callHandler({
        params: {
          name: "unknown_tool",
          arguments: {},
        },
      }),
    ).rejects.toThrow("Unknown tool: unknown_tool");
  });

  it("should handle missing arguments error", async () => {
    const callHandler = mockServer.setRequestHandler.mock.calls[1][1];

    await expect(
      callHandler({
        params: {
          name: "search_openai_sdk_and_docs",
          arguments: null,
        },
      }),
    ).rejects.toThrow("Tool arguments are required");
  });

  it("should handle missing OpenAI API key", async () => {
    const envWithoutKey = { ...mockEnv, OPENAI_API_KEY: undefined };

    const mockServerWithoutKey = {
      setRequestHandler: jest.fn(),
      connect: jest.fn(),
    };
    const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
    Server.mockImplementation(() => mockServerWithoutKey);

    new MCPServer(envWithoutKey as any);
    const callHandler = mockServerWithoutKey.setRequestHandler.mock.calls[1][1];

    const result = await callHandler({
      params: {
        name: TOOL_ANSWER_OPENAI_QUESTIONS,
        arguments: { query: "test" },
      },
    });

    expect(result.content[0].text).toBe("Error: OpenAI API key not configured");
  });
});
