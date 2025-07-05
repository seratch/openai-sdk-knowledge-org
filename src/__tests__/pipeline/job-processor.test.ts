const mockVectorizeIndex = {
  query: jest.fn(),
  upsert: jest.fn(),
  insert: jest.fn(),
  describe: jest.fn(),
  deleteByIds: jest.fn(),
  getByIds: jest.fn(),
};

const mockGitHubCollector = {
  fetchIssues: jest.fn(),
  fetchRepositoryContent: jest.fn(),
};

const mockForumCollector = {
  fetchCategories: jest.fn(),
  fetchCategoryPosts: jest.fn(),
  fetchCategoryPostsWithId: jest.fn(),
  fetchMultiplePages: jest.fn(),
  filterHighQualityPosts: jest.fn(),
  fetchTopicDetails: jest.fn(),
};

const mockIssueSummarizer = {
  summarizeIssue: jest.fn(),
};

const mockForumPostSummarizer = {
  summarizeForumPost: jest.fn(),
};

const mockCodeSnippetGenerator = {
  generateReusableSnippet: jest.fn(),
};

const mockEmbeddingGenerator = {
  batchProcess: jest.fn(),
};

const mockQueue = {
  send: jest.fn(),
};

const mockVectorStore = {
  store: jest.fn(),
};

const mockRateLimiter = {
  executeWithRateLimit: jest.fn().mockImplementation((fn) => fn()),
};

const mockJobQueueMethods = {
  getNextJobs: jest.fn(),
  markJobRunning: jest.fn(),
  markJobCompleted: jest.fn(),
  markJobFailed: jest.fn(),
  createWorkItems: jest.fn().mockResolvedValue([1, 2]),
  createJob: jest.fn(),
  getWorkItem: jest.fn(),
  markWorkItemProcessing: jest.fn(),
  markWorkItemCompleted: jest.fn(),
  markWorkItemFailed: jest.fn(),
  getRunningJobs: jest.fn(),
};

jest.mock("../../pipeline/job-queue", () => ({
  JobQueue: jest.fn().mockImplementation(() => ({
    getNextJobs: mockJobQueueMethods.getNextJobs,
    markJobRunning: mockJobQueueMethods.markJobRunning,
    markJobCompleted: mockJobQueueMethods.markJobCompleted,
    markJobFailed: mockJobQueueMethods.markJobFailed,
    createWorkItems: mockJobQueueMethods.createWorkItems,
    createJob: mockJobQueueMethods.createJob,
    getWorkItem: mockJobQueueMethods.getWorkItem,
    markWorkItemProcessing: mockJobQueueMethods.markWorkItemProcessing,
    markWorkItemCompleted: mockJobQueueMethods.markWorkItemCompleted,
    markWorkItemFailed: mockJobQueueMethods.markWorkItemFailed,
    getRunningJobs: mockJobQueueMethods.getRunningJobs,
  })),
}));

const mockJobQueue = mockJobQueueMethods;

jest.mock("../../pipeline/collectors/github", () => ({
  GitHubCollectorImpl: jest.fn().mockImplementation(() => mockGitHubCollector),
}));

jest.mock("../../pipeline/collectors/forum", () => ({
  ForumCollectorImpl: jest.fn().mockImplementation(() => mockForumCollector),
}));

jest.mock("../../pipeline/processors/issue-summarizer", () => ({
  IssueSummarizerImpl: jest.fn().mockImplementation(() => mockIssueSummarizer),
}));

jest.mock("../../agents/forum-summarizer-agent", () => ({
  ForumPostSummarizerAgent: jest
    .fn()
    .mockImplementation(() => mockForumPostSummarizer),
}));

jest.mock("../../agents/code-snippet-generator-agent", () => ({
  CodeSnippetGeneratorAgent: jest
    .fn()
    .mockImplementation(() => mockCodeSnippetGenerator),
}));

jest.mock("../../pipeline/processors/embeddings", () => ({
  EmbeddingGeneratorImpl: jest
    .fn()
    .mockImplementation(() => mockEmbeddingGenerator),
}));

jest.mock("../../storage/vector-store", () => ({
  VectorStoreImpl: jest.fn().mockImplementation(() => mockVectorStore),
  getVectorStore: jest.fn().mockImplementation(() => mockVectorStore),
}));

jest.mock("../../rate-limiter", () => ({
  RateLimiter: jest.fn().mockImplementation(() => mockRateLimiter),
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

import { JobProcessor } from "../../pipeline/job-processor";
import { createMockJob } from "../utils/mocks";

describe("JobProcessor", () => {
  let jobProcessor: JobProcessor;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    };

    jobProcessor = new JobProcessor({
      DB: mockDb,
      VECTORIZE_PROD: mockVectorizeIndex as any,
      GITHUB_TOKEN: "test-github-token",
      OPENAI_API_KEY: "test-openai-key",
      LOG_LEVEL: "debug",
      ENVIRONMENT: "test",
      JOB_QUEUE: mockQueue as any,
    });

    jest.clearAllMocks();
  });

  describe("processNextJobs", () => {
    it("should return zero counts when no jobs available", async () => {
      mockJobQueue.getNextJobs.mockResolvedValue([]);

      const result = await jobProcessor.processNextJobs(5);

      expect(result).toEqual({
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
      });
      expect(mockJobQueue.getNextJobs).toHaveBeenCalledWith(5);
    });

    it("should process jobs successfully", async () => {
      const mockJobs = [
        createMockJob({
          id: 1,
          jobType: "github_collect",
          payload:
            '{"owner":"test","repo":"repo","collectionRunId":1,"maxPages":2}',
        }),
      ];
      mockJobQueue.getNextJobs.mockResolvedValue(mockJobs);
      mockGitHubCollector.fetchIssues.mockResolvedValue([]);
      mockGitHubCollector.fetchRepositoryContent.mockResolvedValue([]);

      const result = await jobProcessor.processNextJobs(5);

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
      expect(mockJobQueue.markJobRunning).toHaveBeenCalledWith(1);
      expect(mockJobQueue.markJobCompleted).toHaveBeenCalledWith(1);
    });

    it("should handle job processing failures", async () => {
      const mockJobs = [
        createMockJob({
          id: 1,
          jobType: "unknown_type",
          payload: '{"test":"data"}',
        }),
      ];
      mockJobQueue.getNextJobs.mockResolvedValue(mockJobs);

      const result = await jobProcessor.processNextJobs(5);

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Unknown job type: unknown_type");
      expect(mockJobQueue.markJobRunning).toHaveBeenCalledWith(1);
      expect(mockJobQueue.markJobFailed).toHaveBeenCalledWith(
        1,
        "Unknown job type: unknown_type",
      );
    });

    it("should process multiple jobs with mixed results", async () => {
      const mockJobs = [
        createMockJob({
          id: 1,
          jobType: "github_collect",
          payload: '{"owner":"test","repo":"repo","collectionRunId":1}',
        }),
        createMockJob({
          id: 2,
          jobType: "invalid_type",
          payload: '{"test":"data"}',
        }),
      ];
      mockJobQueue.getNextJobs.mockResolvedValue(mockJobs);
      mockGitHubCollector.fetchIssues.mockResolvedValue([]);
      mockGitHubCollector.fetchRepositoryContent.mockResolvedValue([]);

      const result = await jobProcessor.processNextJobs(5);

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("processGitHubCollection", () => {
    it("should collect GitHub issues and files successfully", async () => {
      const mockIssues = [
        {
          number: 1,
          title: "Test Issue",
          body: "Issue body",
          state: "open",
          created_at: "2023-01-01T00:00:00Z",
          updated_at: "2023-01-01T00:00:00Z",
          labels: [{ name: "bug" }],
          user: { login: "testuser" },
        },
      ];
      const mockFiles = [
        {
          name: "README.md",
          path: "README.md",
          type: "file",
          content:
            "This is a long README content that exceeds 200 characters and should be included in the work items for processing. It contains important documentation about the project and provides detailed instructions for developers who want to contribute to this codebase. The README includes setup instructions, usage examples, and troubleshooting guides.",
          download_url: "https://example.com/readme",
        },
      ];

      mockGitHubCollector.fetchIssues.mockResolvedValue(mockIssues);
      mockGitHubCollector.fetchRepositoryContent.mockResolvedValue(mockFiles);

      const job = createMockJob({
        jobType: "github_collect",
        payload:
          '{"owner":"test","repo":"repo","collectionRunId":1,"maxPages":2}',
      });

      await jobProcessor["processGitHubCollection"](job);

      expect(mockGitHubCollector.fetchIssues).toHaveBeenCalledWith(
        "test",
        "repo",
        "all",
        undefined,
        2,
      );
      expect(mockGitHubCollector.fetchRepositoryContent).toHaveBeenCalledWith(
        "test",
        "repo",
      );
      expect(mockJobQueue.createJob).toHaveBeenCalledWith(
        "process_github_batch",
        expect.objectContaining({
          collectionRunId: 1,
          batchData: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                number: 1,
                title: "Test Issue",
              }),
            ]),
            files: expect.arrayContaining([
              expect.objectContaining({
                name: "README.md",
                path: "README.md",
              }),
            ]),
          }),
          chunkSize: 10,
        }),
        1,
        5,
      );
      expect(mockJobQueue.createWorkItems).not.toHaveBeenCalled();
    });

    it("should filter out short files", async () => {
      const mockFiles = [
        {
          name: "short.txt",
          path: "short.txt",
          type: "file",
          content: "Short",
          download_url: "https://example.com/short",
        },
      ];

      mockGitHubCollector.fetchIssues.mockResolvedValue([]);
      mockGitHubCollector.fetchRepositoryContent.mockResolvedValue(mockFiles);

      const job = createMockJob({
        jobType: "github_collect",
        payload: '{"owner":"test","repo":"repo","collectionRunId":1}',
      });

      await jobProcessor["processGitHubCollection"](job);

      expect(mockJobQueue.createJob).not.toHaveBeenCalled();
    });
  });

  describe("processForumCollection", () => {
    it("should collect forum posts successfully", async () => {
      const mockCategories = [
        { id: 1, name: "General", slug: "general" },
        { id: 2, name: "API", slug: "api" },
      ];
      const mockPosts = [
        {
          id: 1,
          title: "How to use API",
          excerpt: "Question about API usage",
          created_at: "2023-01-01T00:00:00Z",
          author: "user1",
        },
      ];

      mockForumCollector.fetchCategories.mockResolvedValue(mockCategories);
      mockForumCollector.fetchMultiplePages.mockResolvedValue(mockPosts);
      mockForumCollector.filterHighQualityPosts.mockReturnValue(mockPosts);

      const job = createMockJob({
        jobType: "forum_collect",
        payload: '{"categories":["general"],"collectionRunId":1}',
      });

      await jobProcessor["processForumCollection"](job);

      expect(mockForumCollector.fetchCategories).toHaveBeenCalled();
      expect(mockForumCollector.fetchMultiplePages).toHaveBeenCalledWith(
        expect.any(Function),
        3,
        100,
      );
      expect(mockForumCollector.filterHighQualityPosts).toHaveBeenCalledWith(
        mockPosts,
      );
      expect(mockJobQueue.createJob).toHaveBeenCalledWith(
        "process_forum_batch",
        expect.objectContaining({
          collectionRunId: 1,
          batchData: expect.objectContaining({
            posts: expect.arrayContaining([
              expect.objectContaining({
                type: "forum_post",
                id: "1",
                data: expect.objectContaining({
                  post: expect.objectContaining({
                    id: 1,
                    title: "How to use API",
                  }),
                }),
              }),
            ]),
          }),
          chunkSize: 10,
        }),
        1,
        5,
      );
    });

    it("should use default categories when none specified", async () => {
      const mockCategories = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        name: `Category ${i + 1}`,
        slug: `category-${i + 1}`,
      }));

      mockForumCollector.fetchCategories.mockResolvedValue(mockCategories);
      mockForumCollector.fetchMultiplePages.mockResolvedValue([]);
      mockForumCollector.filterHighQualityPosts.mockReturnValue([]);

      const job = createMockJob({
        jobType: "forum_collect",
        payload: '{"collectionRunId":1}',
      });

      await jobProcessor["processForumCollection"](job);

      expect(mockForumCollector.fetchMultiplePages).toHaveBeenCalledTimes(25);
    });
  });

  describe("job retry logic", () => {
    it("should handle job retry when retry count is below max retries", async () => {
      const mockJobs = [
        createMockJob({
          id: 1,
          jobType: "invalid_type",
          retryCount: 1,
          maxRetries: 3,
        }),
      ];
      mockJobQueue.getNextJobs.mockResolvedValue(mockJobs);

      const result = await jobProcessor.processNextJobs(1);

      expect(result.failed).toBe(1);
      expect(mockJobQueue.markJobFailed).toHaveBeenCalledWith(
        1,
        "Unknown job type: invalid_type",
      );
    });

    it("should handle job permanent failure when retry count exceeds max retries", async () => {
      const mockJobs = [
        createMockJob({
          id: 1,
          jobType: "invalid_type",
          retryCount: 3,
          maxRetries: 3,
        }),
      ];
      mockJobQueue.getNextJobs.mockResolvedValue(mockJobs);

      const result = await jobProcessor.processNextJobs(1);

      expect(result.failed).toBe(1);
      expect(mockJobQueue.markJobFailed).toHaveBeenCalledWith(
        1,
        "Unknown job type: invalid_type",
      );
    });
  });
});
