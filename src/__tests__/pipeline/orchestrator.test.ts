import { DataPipelineOrchestrator } from "../../pipeline/orchestrator";
import { mockD1Database } from "../utils/mocks";

jest.mock("../../pipeline/collectors/forum", () => ({
  ForumCollectorImpl: jest.fn().mockImplementation(() => ({
    fetchCategories: jest.fn().mockResolvedValue([
      {
        id: 1,
        name: "General",
        slug: "general",
        description: "General discussion",
        topic_count: 10,
      },
    ]),
    fetchCategoryPosts: jest.fn().mockResolvedValue([
      {
        id: 1,
        title: "Test Post",
        content:
          "This is a test post with substantial content for testing purposes.",
        author: "testuser",
        created_at: "2023-01-01T00:00:00Z",
        reply_count: 5,
        like_count: 3,
        category_id: 1,
        tags: ["test"],
      },
    ]),
    fetchTopicDetails: jest.fn().mockResolvedValue({
      id: 1,
      title: "Test Post",
      posts: [{ content: "Test post content" }],
      category_id: 1,
      tags: ["test"],
      last_posted_at: "2023-01-01T12:00:00Z",
    }),
    filterHighQualityPosts: jest.fn().mockImplementation((posts) => posts),
  })),
}));

jest.mock("../../pipeline/collectors/github", () => ({
  GitHubCollectorImpl: jest.fn().mockImplementation(() => ({
    fetchIssues: jest.fn().mockResolvedValue([
      {
        id: 1,
        number: 1,
        title: "Test Issue",
        body: "This is a test issue with substantial content for testing purposes.",
        state: "open",
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2023-01-01T00:00:00Z",
        labels: ["bug"],
        author: "testuser",
      },
    ]),
    fetchRepositoryContent: jest.fn().mockResolvedValue([
      {
        name: "README.md",
        path: "README.md",
        type: "file",
        content:
          "This is a README file with substantial content for testing purposes.",
        download_url: "https://example.com/readme.md",
      },
    ]),
  })),
}));

jest.mock("../../pipeline/processors/text-processor", () => ({
  TextProcessorImpl: jest.fn().mockImplementation(() => ({
    chunkDocuments: jest.fn().mockImplementation((docs: any[]) =>
      docs.map((doc: any) => ({
        ...doc,
        id: `${doc.id}_chunk_1`,
      })),
    ),
  })),
}));

jest.mock("../../pipeline/processors/embeddings", () => ({
  EmbeddingGeneratorImpl: jest.fn().mockImplementation(() => ({
    batchProcess: jest.fn().mockImplementation((docs: any[]) =>
      docs.map((doc: any) => ({
        ...doc,
        embedding: new Array(1536).fill(0.1),
      })),
    ),
  })),
}));

jest.mock("../../storage/vector-store", () => ({
  VectorStoreImpl: jest.fn().mockImplementation(() => ({
    store: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../../logger", () => ({
  Logger: {
    debug: jest.fn(),
    lazyDebug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("DataPipelineOrchestrator", () => {
  let orchestrator: DataPipelineOrchestrator;

  beforeEach(() => {
    mockD1Database.prepare().bind().first.mockResolvedValue(null);
    mockD1Database
      .prepare()
      .bind()
      .run.mockResolvedValue({ meta: { last_row_id: 1 } });

    orchestrator = new DataPipelineOrchestrator(
      {
        DB: mockD1Database as any,
        OPENAI_API_KEY: "test-openai-key",
        GITHUB_TOKEN: "test-github-token",
        ENVIRONMENT: "test",
        LOG_LEVEL: "debug",
        JOB_QUEUE: { send: jest.fn() } as any,
      },
      () => false,
    );
  });

  describe("runDataCollection", () => {
    it("should collect and process forum data successfully", async () => {
      const options = {
        sources: ["forum" as const],
        forumCategories: ["general"],
        batchSize: 10,
      };

      await orchestrator.runDataCollection(options);

      expect(mockD1Database.prepare).toHaveBeenCalled();
    });

    it("should collect and process GitHub data successfully", async () => {
      const options = {
        sources: ["github" as const],
        githubRepos: [{ owner: "test", repo: "repo" }],
        batchSize: 10,
      };

      await orchestrator.runDataCollection(options);

      expect(mockD1Database.prepare).toHaveBeenCalled();
    });

    it("should handle both forum and GitHub sources", async () => {
      const options = {
        sources: ["forum" as const, "github" as const],
        forumCategories: ["general"],
        githubRepos: [{ owner: "test", repo: "repo" }],
        batchSize: 10,
      };

      await orchestrator.runDataCollection(options);

      expect(mockD1Database.prepare).toHaveBeenCalled();
    });

    it("should handle cancellation gracefully", async () => {
      let cancelled = false;
      const orchestratorWithCancellation = new DataPipelineOrchestrator(
        {
          DB: mockD1Database as any,
          OPENAI_API_KEY: "test-openai-key",
          GITHUB_TOKEN: "test-github-token",
          ENVIRONMENT: "test",
          LOG_LEVEL: "debug",
          JOB_QUEUE: { send: jest.fn() } as any,
        },
        () => cancelled,
      );

      const options = {
        sources: ["forum" as const],
        batchSize: 10,
      };

      cancelled = true;

      await expect(
        orchestratorWithCancellation.runDataCollection(options),
      ).rejects.toThrow("Data collection was cancelled");
    });
  });
});
