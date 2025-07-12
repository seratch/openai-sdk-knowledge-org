import { GitHubCollectorImpl } from "../../../pipeline/collectors/github";
import {
  mockGitHubIssuesResponse,
  mockGitHubContentResponse,
  createMockFetch,
} from "../../utils/mocks";

jest.mock("../../../rate-limiter", () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    executeWithRateLimit: jest.fn().mockImplementation((fn) => fn()),
  })),
}));

jest.mock("../../../logger", () => ({
  Logger: {
    debug: jest.fn(),
    lazyDebug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("GitHubCollectorImpl", () => {
  let collector: GitHubCollectorImpl;

  beforeEach(() => {
    global.fetch = createMockFetch({
      "/repos/test/repo/issues": mockGitHubIssuesResponse,
      "/repos/test/repo/contents": mockGitHubContentResponse,
      "/repos/test/repo/pulls": [],
      "raw.githubusercontent.com": "File content from GitHub",
    });

    collector = new GitHubCollectorImpl("test-token");
  });

  describe("fetchIssues", () => {
    it("should fetch issues successfully", async () => {
      const issues = await collector.fetchIssues("test", "repo");

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual({
        id: 1,
        number: 1,
        title: "Test Issue",
        body: "This is a test issue body with substantial content for testing purposes.",
        state: "open",
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2023-01-01T00:00:00Z",
        labels: ["bug", "help wanted"],
        author: "testuser",
      });
    });

    it("should filter out pull requests from issues", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/issues": [
          ...mockGitHubIssuesResponse,
          { ...mockGitHubIssuesResponse[0], id: 2, pull_request: {} },
        ],
      });

      const issues = await collector.fetchIssues("test", "repo");
      expect(issues).toHaveLength(1);
    });

    it("should handle API errors", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: jest
          .fn()
          .mockResolvedValue(
            '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
          ),
      });

      await expect(collector.fetchIssues("test", "repo")).rejects.toThrow(
        'HTTP 404: Not Found. Response: {"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
      );
    });
  });

  describe("fetchRepositoryContent", () => {
    it("should fetch repository content successfully", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": mockGitHubContentResponse,
        "raw.githubusercontent.com": "File content from GitHub",
      });

      const content = await collector.fetchRepositoryContent(
        "test",
        "repo",
        "",
        0,
      );

      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({
        name: "README.md",
        path: "README.md",
        type: "file",
        content: "File content from GitHub",
        download_url:
          "https://raw.githubusercontent.com/test/repo/main/README.md",
        url: "https://raw.githubusercontent.com/test/repo/main/README.md",
      });
      expect(content[1]).toEqual({
        name: "src",
        path: "src",
        type: "dir",
      });
    });

    it("should filter relevant files", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": [
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "image.png",
            path: "image.png",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "script.js",
            path: "script.js",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");

      expect(content.filter((c) => c.type === "file")).toHaveLength(2);
      expect(content.find((c) => c.name === "image.png")).toBeUndefined();
    });
  });

  describe("fetchPullRequests", () => {
    it("should fetch pull requests successfully", async () => {
      const mockPRs = [
        {
          id: 1,
          number: 1,
          title: "Test PR",
          body: "PR description",
          state: "open",
          created_at: "2023-01-01T00:00:00Z",
          updated_at: "2023-01-01T00:00:00Z",
          user: { login: "contributor" },
        },
      ];

      global.fetch = createMockFetch({
        "/repos/test/repo/pulls": mockPRs,
      });

      const prs = await collector.fetchPullRequests("test", "repo");

      expect(prs).toHaveLength(1);
      expect(prs[0]).toEqual({
        id: 1,
        number: 1,
        title: "Test PR",
        body: "PR description",
        state: "open",
        created_at: "2023-01-01T00:00:00Z",
        updated_at: "2023-01-01T00:00:00Z",
        author: "contributor",
      });
    });
  });

  describe("isRelevantFile filtering", () => {
    it("should include all source files from openai/build-hours repository", async () => {
      global.fetch = createMockFetch({
        "/repos/openai/build-hours/contents": [
          {
            name: "_internal.py",
            path: "src/openai/_internal.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "client.py",
            path: "lib/client.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "example.js",
            path: "examples/example.js",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent(
        "openai",
        "build-hours",
      );
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(4);
      expect(files.map((f) => f.name)).toEqual([
        "_internal.py",
        "client.py",
        "example.js",
        "README.md",
      ]);
    });

    it("should include all source files from non-SDK openai repositories", async () => {
      global.fetch = createMockFetch({
        "/repos/openai/cookbook/contents": [
          {
            name: "_internal.py",
            path: "src/openai/_internal.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "client.py",
            path: "lib/client.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "example.js",
            path: "examples/example.js",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent(
        "openai",
        "cookbook",
      );
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(4);
      expect(files.map((f) => f.name)).toEqual([
        "_internal.py",
        "client.py",
        "example.js",
        "README.md",
      ]);
    });

    it("should still exclude SDK files from openai-* repositories", async () => {
      global.fetch = createMockFetch({
        "/repos/openai/openai-python/contents": [
          {
            name: "_internal.py",
            path: "src/openai/_internal.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "client.py",
            path: "lib/client.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent(
        "openai",
        "openai-python",
      );
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("README.md");
    });
    it("should exclude internal Python SDK files", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": [
          {
            name: "_response.py",
            path: "src/openai/_response.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "_base.py",
            path: "src/openai/_base.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "client.py",
            path: "src/openai/lib/client.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("README.md");
    });

    it("should exclude internal Node.js SDK files", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": [
          {
            name: "_client.ts",
            path: "src/_client.ts",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "internal.js",
            path: "lib/internal.js",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "index.d.ts",
            path: "dist/index.d.ts",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "example.js",
            path: "examples/example.js",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("example.js");
    });

    it("should include user-facing documentation and examples", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": [
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "guide.md",
            path: "docs/guide.md",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "example.py",
            path: "examples/example.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "test_client.py",
            path: "tests/test_client.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "_internal.py",
            path: "src/openai/_internal.py",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(4);
      expect(files.map((f) => f.name)).toEqual([
        "README.md",
        "guide.md",
        "example.py",
        "test_client.py",
      ]);
    });

    it("should prioritize examples and test files", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": [
          {
            name: "sample.py",
            path: "examples/sample.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "demo.js",
            path: "samples/demo.js",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "test_api.py",
            path: "src/tests/test_api.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "unit.spec.ts",
            path: "src/test/unit.spec.ts",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "_internal.py",
            path: "src/openai/_internal.py",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(4);
      expect(files.map((f) => f.name)).toEqual([
        "sample.py",
        "demo.js",
        "test_api.py",
        "unit.spec.ts",
      ]);
    });

    it("should exclude deeper nested internal SDK files while including test directories", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents": [
          {
            name: "deep_internal.py",
            path: "src/openai/internal/utils/deep_internal.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "nested.js",
            path: "lib/internal/nested.js",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "test_helper.py",
            path: "src/test/test_helper.py",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "Foo.java",
            path: "openai-java/src/main/Foo.java",
            type: "file",
            download_url: "http://test.com",
          },
          {
            name: "FooTest.java",
            path: "openai-java/src/test/FooTest.java",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(2);
      expect(files[0].name).toBe("test_helper.py");
      expect(files[1].name).toBe("FooTest.java");
    });
  });

  describe("recursive directory traversal", () => {
    it("should recursively fetch files from subdirectories", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents/src/utils": [
          {
            name: "helper.py",
            path: "src/utils/helper.py",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "/repos/test/repo/contents/src": [
          {
            name: "main.py",
            path: "src/main.py",
            type: "file",
            download_url: "http://test.com",
          },
          { name: "utils", path: "src/utils", type: "dir" },
        ],
        "/repos/test/repo/contents": [
          {
            name: "README.md",
            path: "README.md",
            type: "file",
            download_url: "http://test.com",
          },
          { name: "src", path: "src", type: "dir" },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.path)).toEqual(["README.md", "src/main.py"]);
    });

    it("should respect maxDepth parameter", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents/src/deep": [
          {
            name: "nested.py",
            path: "src/deep/nested.py",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "/repos/test/repo/contents/src": [
          {
            name: "main.py",
            path: "src/main.py",
            type: "file",
            download_url: "http://test.com",
          },
          { name: "deep", path: "src/deep", type: "dir" },
        ],
        "/repos/test/repo/contents": [
          { name: "src", path: "src", type: "dir" },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent(
        "test",
        "repo",
        "",
        1,
      );
      const files = content.filter((c) => c.type === "file");
      const dirs = content.filter((c) => c.type === "dir");

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("src/main.py");
      expect(dirs).toHaveLength(2);
      expect(dirs.map((d) => d.path)).toEqual(["src", "src/deep"]);
    });

    it("should handle deeply nested directories", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents/level1/level2/level3": [
          {
            name: "deep.py",
            path: "level1/level2/level3/deep.py",
            type: "file",
            download_url: "http://test.com",
          },
        ],
        "/repos/test/repo/contents/level1/level2": [
          { name: "level3", path: "level1/level2/level3", type: "dir" },
        ],
        "/repos/test/repo/contents/level1": [
          { name: "level2", path: "level1/level2", type: "dir" },
        ],
        "/repos/test/repo/contents": [
          { name: "level1", path: "level1", type: "dir" },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent("test", "repo");
      const files = content.filter((c) => c.type === "file");

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe("level1/level2/level3/deep.py");
    });

    it("should stop traversal when maxDepth is reached", async () => {
      global.fetch = createMockFetch({
        "/repos/test/repo/contents/level1/level2": [
          { name: "level3", path: "level1/level2/level3", type: "dir" },
        ],
        "/repos/test/repo/contents/level1": [
          { name: "level2", path: "level1/level2", type: "dir" },
        ],
        "/repos/test/repo/contents": [
          { name: "level1", path: "level1", type: "dir" },
        ],
        "test.com": "File content",
      });

      const content = await collector.fetchRepositoryContent(
        "test",
        "repo",
        "",
        2,
      );
      const dirs = content.filter((c) => c.type === "dir");

      expect(dirs).toHaveLength(3);
      expect(dirs.map((d) => d.path)).toEqual([
        "level1",
        "level1/level2",
        "level1/level2/level3",
      ]);
    });
  });
});
