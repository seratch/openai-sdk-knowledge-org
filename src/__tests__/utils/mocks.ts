export const mockOpenAIEmbeddingResponse = {
  data: [
    { embedding: new Array(1536).fill(0).map(() => Math.random()) },
    { embedding: new Array(1536).fill(0).map(() => Math.random()) },
  ],
};


export const mockD1Database = {
  prepare: jest.fn().mockReturnValue({
    bind: jest.fn().mockReturnValue({
      run: jest.fn().mockResolvedValue({ meta: { last_row_id: 1 } }),
      first: jest.fn().mockResolvedValue(null),
      all: jest.fn().mockResolvedValue({ results: [] }),
    }),
    all: jest.fn().mockResolvedValue({ results: [] }),
  }),
  batch: jest.fn().mockResolvedValue([]),
};

export const mockEnv = {
  DB: mockD1Database,
  OPENAI_API_KEY: "test-openai-key",
  GITHUB_TOKEN: "test-github-token",
  DISCOURSE_API_KEY: "test-discourse-key",
  ENVIRONMENT: "test",
  LOG_LEVEL: "debug",
  JOB_QUEUE: { send: jest.fn() } as any,
};

export const mockGitHubIssuesResponse = [
  {
    id: 1,
    number: 1,
    title: "Test Issue",
    body: "This is a test issue body with substantial content for testing purposes.",
    state: "open",
    created_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    labels: [{ name: "bug" }, { name: "help wanted" }],
    user: { login: "testuser" },
    pull_request: null,
  },
];

export const mockGitHubContentResponse = [
  {
    name: "README.md",
    path: "README.md",
    type: "file",
    download_url: "https://raw.githubusercontent.com/test/repo/main/README.md",
  },
  {
    name: "src",
    path: "src",
    type: "dir",
  },
];

export const mockDiscourseResponse = {
  category_list: {
    categories: [
      {
        id: 1,
        name: "General",
        slug: "general",
        description: "General discussion",
        topic_count: 10,
      },
    ],
  },
};

export const mockForumTopicsResponse = {
  topic_list: {
    topics: [
      {
        id: 1,
        title: "How to use OpenAI API",
        excerpt: "This is a question about using the OpenAI API effectively.",
        created_at: "2023-01-01T00:00:00Z",
        reply_count: 5,
        like_count: 3,
        category_id: 1,
        tags: ["api", "help"],
        last_poster_username: "helper",
      },
    ],
  },
};

export const createMockFetch = (responses: Record<string, any>) => {
  return jest.fn().mockImplementation((url: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(response),
          text: () =>
            Promise.resolve(
              typeof response === "string"
                ? response
                : JSON.stringify(response),
            ),
        });
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
  });
};

export const createMockJob = (overrides: any = {}) => ({
  id: 1,
  jobType: "github_collect",
  status: "pending",
  priority: 0,
  payload: '{"owner":"test","repo":"repo","collectionRunId":1}',
  collectionRunId: 1,
  retryCount: 0,
  maxRetries: 3,
  createdAt: "2023-01-01T00:00:00Z",
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  ...overrides,
});

