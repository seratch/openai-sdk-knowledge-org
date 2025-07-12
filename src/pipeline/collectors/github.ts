import { RateLimiter, RateLimitConfig } from "@/rate-limiter";
import { Logger } from "@/logger";

/**
 * Represents a file or directory from GitHub repository contents API.
 * Source: GET /repos/{owner}/{repo}/contents/{path}
 * Identifier: Use `path` as unique identifier within a repository
 */
export interface GitHubContent {
  name: string; // File or directory name
  url: string; // File or directory URL
  path: string; // Full path from repository root (unique identifier)
  type: "file" | "dir"; // Content type from GitHub API
  content?: string; // File content (only for files, not directories)
  download_url?: string; // Direct download URL from GitHub
}

/**
 * Represents a GitHub issue comment for collecting conversation details.
 * Source: GET /repos/{owner}/{repo}/issues/{issue_number}/comments
 * Identifier: Use `id` (unique across GitHub)
 */
export interface GitHubIssueComment {
  id: number; // GitHub's global comment ID (unique identifier)
  body: string; // Comment content
  author: string; // GitHub username
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * Represents a GitHub issue for collecting community questions and discussions.
 * Source: GET /repos/{owner}/{repo}/issues
 * Identifier: Use `id` (unique across GitHub) or `number` (unique within repository)
 */
export interface GitHubIssue {
  id: number; // GitHub's global issue ID (unique identifier)
  url: string; // Issue URL
  number: number; // Issue number within repository
  title: string; // Issue title
  body: string; // Issue description/content
  state: string; // 'open' | 'closed'
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  labels: string[]; // Label names
  author: string; // GitHub username
  comments?: GitHubIssueComment[]; // Issue comments for conversation
}

/**
 * Represents a GitHub pull request for collecting code examples and discussions.
 * Source: GET /repos/{owner}/{repo}/pulls
 * Identifier: Use `id` (unique across GitHub) or `number` (unique within repository)
 */
export interface GitHubPullRequest {
  id: number; // GitHub's global PR ID (unique identifier)
  url: string; // PR URL
  number: number; // PR number within repository
  title: string; // PR title
  body: string; // PR description/content
  state: string; // 'open' | 'closed' | 'merged'
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  author: string; // GitHub username
}

export interface ConditionalRequestOptions {
  etag?: string;
  lastModified?: string;
}

export interface ConditionalResponse<T> {
  data?: T;
  notModified: boolean;
  etag?: string;
  lastModified?: string;
}

/**
 * Interface for collecting data from GitHub repositories.
 * Focuses on text-based content that provides meaningful information for OpenAI SDK users.
 */
export interface GitHubCollector {
  fetchRepositoryContent(
    owner: string,
    repo: string,
    path?: string,
    maxDepth?: number,
  ): Promise<GitHubContent[]>;
  fetchIssues(
    owner: string,
    repo: string,
    state?: "open" | "closed" | "all",
    since?: string,
    maxPages?: number,
  ): Promise<GitHubIssue[]>;
  fetchIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueComment[]>;
  fetchPullRequests(
    owner: string,
    repo: string,
    state?: "open" | "closed" | "all",
    since?: string,
  ): Promise<GitHubPullRequest[]>;
  fetchIssuesConditional(
    owner: string,
    repo: string,
    state?: "open" | "closed" | "all",
    since?: string,
    maxPages?: number,
    conditionalOptions?: ConditionalRequestOptions,
  ): Promise<ConditionalResponse<GitHubIssue[]>>;
  fetchPullRequestsConditional(
    owner: string,
    repo: string,
    state?: "open" | "closed" | "all",
    since?: string,
    conditionalOptions?: ConditionalRequestOptions,
  ): Promise<ConditionalResponse<GitHubPullRequest[]>>;
  fetchRepositoryContentConditional(
    owner: string,
    repo: string,
    path?: string,
    maxDepth?: number,
    conditionalOptions?: ConditionalRequestOptions,
  ): Promise<ConditionalResponse<GitHubContent[]>>;
}

const USER_AGENT = "seratch/openai-sdk-data-collector 0.1";

export class GitHubCollectorImpl implements GitHubCollector {
  private rateLimiter: RateLimiter;

  constructor(
    private token?: string,
    private baseUrl: string = "https://api.github.com",
  ) {
    const rateLimitConfig: RateLimitConfig = {
      requestsPerMinute: this.token ? 180 : 55,
      retryAttempts: 3,
      baseDelayMs: 1000,
      jitterStrategy: "decorrelated",
    };
    this.rateLimiter = new RateLimiter(rateLimitConfig);
  }

  async fetchRepositoryContent(
    owner: string,
    repo: string,
    path: string = "",
    maxDepth: number = 5,
  ): Promise<GitHubContent[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () =>
          `Fetching repository content for ${owner}/${repo}${path ? `/${path}` : ""} (depth: ${5 - maxDepth + 1})`,
      );

      if (maxDepth < 0) {
        Logger.lazyDebug(
          () => `Max depth reached for ${path}, skipping further traversal`,
        );
        return [];
      }

      const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": USER_AGENT,
      };

      if (this.token) {
        headers["Authorization"] = `token ${this.token}`;
      }

      Logger.lazyDebug(() => `Making GitHub API request to: ${url}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Unable to read response body");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
        );
      }

      const data = (await response.json()) as any;
      const items = Array.isArray(data) ? data : [data];

      const results: GitHubContent[] = [];
      const directoryPromises: Promise<GitHubContent[]>[] = [];

      for (const item of items) {
        if (
          item.type === "file" &&
          this.isRelevantFile(item.path, owner, repo)
        ) {
          Logger.lazyDebug(() => `Processing relevant file: ${item.path}`);
          const content = await this.fetchFileContent(item.download_url);
          results.push({
            name: item.name,
            url: item.download_url ?? item.url,
            path: item.path,
            type: "file",
            content,
            download_url: item.download_url,
          });
        } else if (item.type === "dir" && maxDepth > 0) {
          Logger.lazyDebug(
            () => `Found directory: ${item.path}, will traverse recursively`,
          );
          results.push({
            name: item.name,
            url: item.url,
            path: item.path,
            type: "dir",
          });

          directoryPromises.push(
            this.fetchRepositoryContent(owner, repo, item.path, maxDepth - 1),
          );
        } else if (item.type === "dir") {
          Logger.lazyDebug(
            () => `Found directory: ${item.path}, but max depth reached`,
          );
          results.push({
            name: item.name,
            url: item.url,
            path: item.path,
            type: "dir",
          });
        }
      }

      if (directoryPromises.length > 0) {
        Logger.lazyDebug(
          () =>
            `Processing ${directoryPromises.length} subdirectories sequentially`,
        );
        for (let i = 0; i < directoryPromises.length; i++) {
          const dirResult = await directoryPromises[i];
          results.push(...dirResult);

          if (i < directoryPromises.length - 1) {
            const delay = Math.random() * 2000 + 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      Logger.lazyDebug(
        () =>
          `Fetched ${results.length} items from ${owner}/${repo}${path ? `/${path}` : ""} (including subdirectories)`,
      );
      return results;
    });
  }

  async fetchIssues(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "all",
    since?: string,
    maxPages: number = 1,
  ): Promise<GitHubIssue[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      const allIssues: GitHubIssue[] = [];
      let page = 1;

      while (page <= maxPages) {
        let url = `${this.baseUrl}/repos/${owner}/${repo}/issues?state=${state}&per_page=100&page=${page}`;
        if (since) {
          url += `&since=${since}`;
        }

        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": USER_AGENT,
        };

        if (this.token) {
          headers["Authorization"] = `token ${this.token}`;
        }

        const response = await fetch(url, { headers });

        if (!response.ok) {
          const errorBody = await response
            .text()
            .catch(() => "Unable to read response body");
          throw new Error(
            `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
          );
        }

        const data = (await response.json()) as any[];

        if (data.length === 0) {
          break;
        }

        const issues = data
          .filter((issue: any) => !issue.pull_request)
          .map((issue: any) => ({
            id: issue.id,
            url: issue.source_url || issue.url,
            number: issue.number,
            title: issue.title || "",
            body: issue.body || "",
            state: issue.state,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            labels: issue.labels?.map((label: any) => label.name) || [],
            author: issue.user?.login || "unknown",
          }));

        allIssues.push(...issues);
        page++;
      }

      return allIssues;
    });
  }

  async fetchIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueComment[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      const url = `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": USER_AGENT,
      };

      if (this.token) {
        headers["Authorization"] = `token ${this.token}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Unable to read response body");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
        );
      }

      const data = (await response.json()) as any[];

      return data.map((comment: any) => ({
        id: comment.id,
        body: comment.body || "",
        author: comment.user?.login || "unknown",
        created_at: comment.created_at,
        updated_at: comment.updated_at,
      }));
    });
  }

  async fetchPullRequests(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "all",
    since?: string,
  ): Promise<GitHubPullRequest[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      let url = `${this.baseUrl}/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`;
      if (since) {
        url += `&since=${since}`;
      }
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": USER_AGENT,
      };

      if (this.token) {
        headers["Authorization"] = `token ${this.token}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Unable to read response body");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
        );
      }

      const data = (await response.json()) as any[];

      return data.map((pr: any) => ({
        id: pr.id,
        url: pr.source_url || pr.url,
        number: pr.number,
        title: pr.title || "",
        body: pr.body || "",
        state: pr.state,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        author: pr.user?.login || "unknown",
      }));
    });
  }

  private async fetchFileContent(downloadUrl: string): Promise<string> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Unable to read response body");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
        );
      }
      return await response.text();
    });
  }

  /**
   * Determines if a file contains meaningful text content for OpenAI SDK users.
   * Strategy: Exclude binary files, build artifacts, internal SDK implementation files,
   * and large files while prioritizing user-facing documentation and examples.
   */
  private isRelevantFile(
    filename: string,
    owner?: string,
    repo?: string,
  ): boolean {
    if (filename.includes("/ja/")) {
      // exclude translated files
      return false;
    }
    const isRecursiveTestFile =
      filename === "README.md" ||
      filename.startsWith("src/main.") ||
      (filename.startsWith("openai-java") &&
        (filename.includes("/test") || filename.includes("/tests")));

    if (isRecursiveTestFile) {
      const excludedExtensions = [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".ico",
        ".webp",
        ".mp4",
        ".avi",
        ".mov",
        ".wmv",
        ".flv",
        ".webm",
        ".mp3",
        ".wav",
        ".flac",
        ".aac",
        ".ogg",
        ".zip",
        ".tar",
        ".gz",
        ".rar",
        ".7z",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".bin",
        ".dat",
        ".db",
        ".sqlite",
        ".log",
        ".tmp",
        ".cache",
        ".lock",
      ];
      const hasExcludedExtension = excludedExtensions.some((ext) =>
        filename.toLowerCase().endsWith(ext),
      );
      return !hasExcludedExtension;
    }

    const excludedExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".ico",
      ".webp",
      ".mp4",
      ".avi",
      ".mov",
      ".wmv",
      ".flv",
      ".webm",
      ".mp3",
      ".wav",
      ".flac",
      ".aac",
      ".ogg",
      ".zip",
      ".tar",
      ".gz",
      ".rar",
      ".7z",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".bin",
      ".dat",
      ".db",
      ".sqlite",
      ".log",
      ".tmp",
      ".cache",
      ".lock",
      ".json",
    ];

    const excludedDirectories = [
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "dist",
      "build",
      "target",
      "bin",
      "obj",
      ".next",
      ".nuxt",
      ".vscode",
      ".idea",
      "coverage",
      ".nyc_output",
      "__pycache__",
    ];

    const excludedLockFiles = [
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "poetry.lock",
      "Pipfile.lock",
      "uv.lock",
      "Cargo.lock",
      "go.sum",
      "go.mod",
      "Gemfile.lock",
      "composer.lock",
      "mix.lock",
      "pubspec.lock",
      "Podfile.lock",
      "flake.lock",
      "deno.lock",
      "bun.lockb",
    ];

    const internalSDKPaths = [
      "/src/openai/",
      "src/openai/",
      "/openai/lib/",
      "openai/lib/",
      "/openai/api/",
      "openai/api/",
      "/openai/types/",
      "openai/types/",
      "/openai/_",
      "openai/_",
      "/src/",
      "src/",
      "/lib/",
      "lib/",
      "/dist/",
      "dist/",
      "/build/",
      "build/",
      "/internal/",
      "internal/",
      "/private/",
      "private/",
      "/__",
      "__",
      "/node_modules/",
      "node_modules/",
      "/.",
    ];

    const internalSDKPatterns = [
      /\/_[^/]*\.(py|js|ts)$/,
      /\.d\.ts$/,
      /\.min\.(js|css)$/,
      /\.map$/,
    ];

    const userFacingPatterns = [
      /README\.md$/i,
      /CHANGELOG\.md$/i,
      /CONTRIBUTING\.md$/i,
      /\/docs?\//,
      /\/examples?\//,
      /\/cookbook\//,
      /\/guides?\//,
      /\.md$/,
      /\/tests?\//,
      /\.(test|spec)\.(js|ts|py)$/,
    ];

    const enhancedUserFacingPatterns = [
      /\/examples?\//,
      /\/tests?\//,
      /\/src\/tests?\//,
      /\/src\/test\//,
      /\.(test|spec)\.(js|ts|py)$/,
      /\/cookbook\//,
      /\/guides?\//,
      /\/samples?\//,
      /\/demos?\//,
    ];

    const pathParts = filename.split("/");
    const hasExcludedDirectory = pathParts.some((part) =>
      excludedDirectories.includes(part),
    );
    if (hasExcludedDirectory) {
      return false;
    }

    const hasExcludedExtension = excludedExtensions.some((ext) =>
      filename.toLowerCase().endsWith(ext),
    );
    if (hasExcludedExtension) {
      return false;
    }

    const fileBaseName = filename.split("/").pop() || "";
    const hasExcludedLockFile = excludedLockFiles.some(
      (lockFile) => fileBaseName.toLowerCase() === lockFile.toLowerCase(),
    );
    if (hasExcludedLockFile) {
      return false;
    }
    const isEnhancedUserFacing = enhancedUserFacingPatterns.some((pattern) =>
      pattern.test(filename),
    );

    const isOpenAINonSDKRepo =
      owner === "openai" && repo && !repo.startsWith("openai-");
    if (!isOpenAINonSDKRepo) {
      const hasInternalSDKPath = internalSDKPaths.some((path) =>
        filename.includes(path),
      );

      const isInternalSDKFile =
        hasInternalSDKPath ||
        internalSDKPatterns.some((pattern) => pattern.test(filename));
      if (isInternalSDKFile) {
        const isUserFacing = userFacingPatterns.some((pattern) =>
          pattern.test(filename),
        );
        if (!isUserFacing && !isEnhancedUserFacing) {
          return false;
        }
      }
    }

    if (isEnhancedUserFacing) {
      return true;
    }

    const fileSize = filename.length;
    if (fileSize > 1000000) {
      return false;
    }
    if (!isOpenAINonSDKRepo) {
      const fileName = filename.split("/").pop() || "";
      if (fileName.startsWith("_")) {
        return false;
      }
    }
    const documentationExtensions = [
      ".md",
      ".rst",
      ".txt",
      ".adoc",
      ".asciidoc",
      ".ipynb",
    ];
    const hasDocumentationExtension = documentationExtensions.some((ext) =>
      filename.toLowerCase().endsWith(ext),
    );

    if (hasDocumentationExtension) {
      return true;
    }
    return true;
  }

  async fetchIssuesConditional(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "all",
    since?: string,
    maxPages: number = 1,
    conditionalOptions?: ConditionalRequestOptions,
  ): Promise<ConditionalResponse<GitHubIssue[]>> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      const allIssues: GitHubIssue[] = [];
      let page = 1;
      const responseHeaders: { etag?: string; lastModified?: string } = {};

      while (page <= maxPages) {
        let url = `${this.baseUrl}/repos/${owner}/${repo}/issues?state=${state}&per_page=100&page=${page}`;
        if (since) {
          url += `&since=${since}`;
        }

        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": USER_AGENT,
        };

        if (this.token) {
          headers["Authorization"] = `token ${this.token}`;
        }

        if (conditionalOptions?.etag && page === 1) {
          headers["If-None-Match"] = conditionalOptions.etag;
        }
        if (conditionalOptions?.lastModified && page === 1) {
          headers["If-Modified-Since"] = conditionalOptions.lastModified;
        }

        const response = await fetch(url, { headers });

        if (response.status === 304) {
          Logger.lazyDebug(
            () => `Issues for ${owner}/${repo} not modified (304)`,
          );
          return {
            notModified: true,
            etag: conditionalOptions?.etag,
            lastModified: conditionalOptions?.lastModified,
          };
        }

        if (!response.ok) {
          const errorBody = await response
            .text()
            .catch(() => "Unable to read response body");
          throw new Error(
            `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
          );
        }

        if (page === 1) {
          responseHeaders.etag = response.headers.get("ETag") || undefined;
          responseHeaders.lastModified =
            response.headers.get("Last-Modified") || undefined;
        }

        const data = (await response.json()) as any[];

        if (data.length === 0) {
          break;
        }

        const issues = data
          .filter((issue: any) => !issue.pull_request)
          .map((issue: any) => ({
            id: issue.id,
            url: issue.source_url || issue.url,
            number: issue.number,
            title: issue.title || "",
            body: issue.body || "",
            state: issue.state,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            labels: issue.labels?.map((label: any) => label.name) || [],
            author: issue.user?.login || "unknown",
          }));

        allIssues.push(...issues);
        page++;
      }

      return {
        data: allIssues,
        notModified: false,
        etag: responseHeaders.etag,
        lastModified: responseHeaders.lastModified,
      };
    });
  }

  async fetchPullRequestsConditional(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "all",
    since?: string,
    conditionalOptions?: ConditionalRequestOptions,
  ): Promise<ConditionalResponse<GitHubPullRequest[]>> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      let url = `${this.baseUrl}/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`;
      if (since) {
        url += `&since=${since}`;
      }
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": USER_AGENT,
      };

      if (this.token) {
        headers["Authorization"] = `token ${this.token}`;
      }

      if (conditionalOptions?.etag) {
        headers["If-None-Match"] = conditionalOptions.etag;
      }
      if (conditionalOptions?.lastModified) {
        headers["If-Modified-Since"] = conditionalOptions.lastModified;
      }

      const response = await fetch(url, { headers });

      if (response.status === 304) {
        Logger.lazyDebug(
          () => `Pull requests for ${owner}/${repo} not modified (304)`,
        );
        return {
          notModified: true,
          etag: conditionalOptions?.etag,
          lastModified: conditionalOptions?.lastModified,
        };
      }

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Unable to read response body");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
        );
      }

      const data = (await response.json()) as any[];

      const pullRequests = data.map((pr: any) => ({
        id: pr.id,
        url,
        number: pr.number,
        title: pr.title || "",
        body: pr.body || "",
        state: pr.state,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        author: pr.user?.login || "unknown",
      }));

      return {
        data: pullRequests,
        notModified: false,
        etag: response.headers.get("ETag") || undefined,
        lastModified: response.headers.get("Last-Modified") || undefined,
      };
    });
  }

  async fetchRepositoryContentConditional(
    owner: string,
    repo: string,
    path: string = "",
    maxDepth: number = 5,
    conditionalOptions?: ConditionalRequestOptions,
  ): Promise<ConditionalResponse<GitHubContent[]>> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () =>
          `Fetching repository content for ${owner}/${repo}${path ? `/${path}` : ""} (depth: ${5 - maxDepth + 1})`,
      );

      if (maxDepth < 0) {
        Logger.lazyDebug(
          () => `Max depth reached for ${path}, skipping further traversal`,
        );
        return { data: [], notModified: false };
      }

      const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": USER_AGENT,
      };

      if (this.token) {
        headers["Authorization"] = `token ${this.token}`;
      }

      if (conditionalOptions?.etag && path === "") {
        headers["If-None-Match"] = conditionalOptions.etag;
      }
      if (conditionalOptions?.lastModified && path === "") {
        headers["If-Modified-Since"] = conditionalOptions.lastModified;
      }

      Logger.lazyDebug(() => `Making GitHub API request to: ${url}`);
      const response = await fetch(url, { headers });

      if (response.status === 304) {
        Logger.lazyDebug(
          () => `Repository content for ${owner}/${repo} not modified (304)`,
        );
        return {
          notModified: true,
          etag: conditionalOptions?.etag,
          lastModified: conditionalOptions?.lastModified,
        };
      }

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Unable to read response body");
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}. Response: ${errorBody}`,
        );
      }

      const data = (await response.json()) as any;
      const items = Array.isArray(data) ? data : [data];

      const results: GitHubContent[] = [];
      const directoryPromises: Promise<GitHubContent[]>[] = [];

      for (const item of items) {
        if (
          item.type === "file" &&
          this.isRelevantFile(item.path, owner, repo)
        ) {
          Logger.lazyDebug(() => `Processing relevant file: ${item.path}`);
          const content = await this.fetchFileContent(item.download_url);
          results.push({
            name: item.name,
            url,
            path: item.path,
            type: "file",
            content,
            download_url: item.download_url,
          });
        } else if (item.type === "dir" && maxDepth > 0) {
          Logger.lazyDebug(
            () => `Found directory: ${item.path}, will traverse recursively`,
          );
          results.push({
            name: item.name,
            url,
            path: item.path,
            type: "dir",
          });

          directoryPromises.push(
            this.fetchRepositoryContent(owner, repo, item.path, maxDepth - 1),
          );
        } else if (item.type === "dir") {
          Logger.lazyDebug(
            () => `Found directory: ${item.path}, but max depth reached`,
          );
          results.push({
            name: item.name,
            url,
            path: item.path,
            type: "dir",
          });
        }
      }

      if (directoryPromises.length > 0) {
        Logger.lazyDebug(
          () =>
            `Processing ${directoryPromises.length} subdirectories sequentially`,
        );
        for (let i = 0; i < directoryPromises.length; i++) {
          const dirResult = await directoryPromises[i];
          results.push(...dirResult);

          if (i < directoryPromises.length - 1) {
            const delay = Math.random() * 2000 + 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      Logger.lazyDebug(
        () =>
          `Fetched ${results.length} items from ${owner}/${repo}${path ? `/${path}` : ""} (including subdirectories)`,
      );

      return {
        data: results,
        notModified: false,
        etag:
          path === "" ? response.headers.get("ETag") || undefined : undefined,
        lastModified:
          path === ""
            ? response.headers.get("Last-Modified") || undefined
            : undefined,
      };
    });
  }
}
