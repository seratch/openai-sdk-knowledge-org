import { ForumCollectorImpl } from "../../../pipeline/collectors/forum";
import {
  mockDiscourseResponse,
  mockForumTopicsResponse,
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

describe("ForumCollectorImpl", () => {
  let collector: ForumCollectorImpl;

  beforeEach(() => {
    global.fetch = createMockFetch({
      "/categories.json": mockDiscourseResponse,
      "/c/general/1.json": mockForumTopicsResponse,
      "/t/1.json": {
        id: 1,
        title: "How to use OpenAI API",
        post_stream: {
          posts: [
            {
              id: 1,
              cooked: "<p>This is the main post content</p>",
              username: "questioner",
              created_at: "2023-01-01T00:00:00Z",
              score: 5,
            },
          ],
        },
        category_id: 1,
        tags: ["api", "help"],
        last_posted_at: "2023-01-01T12:00:00Z",
      },
    });

    collector = new ForumCollectorImpl();
  });

  describe("fetchCategories", () => {
    it("should fetch categories successfully", async () => {
      const categories = await collector.fetchCategories();

      expect(categories).toHaveLength(1);
      expect(categories[0]).toEqual({
        id: 1,
        name: "General",
        slug: "general",
        description: "General discussion",
        topic_count: 10,
      });
    });

    it("should handle API errors", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(collector.fetchCategories()).rejects.toThrow(
        "HTTP 500: Internal Server Error",
      );
    });
  });

  describe("fetchCategoryPosts", () => {
    it("should fetch category posts successfully", async () => {
      const posts = await collector.fetchCategoryPosts("general");

      expect(posts).toHaveLength(1);
      expect(posts[0]).toEqual({
        id: 1,
        title: "How to use OpenAI API",
        content:
          "How to use OpenAI API\n\nThis is a question about using the OpenAI API effectively.",
        author: "helper",
        created_at: "2023-01-01T00:00:00Z",
        reply_count: 5,
        like_count: 3,
        category_id: 1,
        tags: ["api", "help"],
      });
    });
  });

  describe("fetchTopicDetails", () => {
    it("should fetch topic details successfully", async () => {
      const topic = await collector.fetchTopicDetails(1);

      expect(topic).toEqual({
        id: 1,
        title: "How to use OpenAI API",
        posts: [
          {
            id: 1,
            title: "",
            content: "This is the main post content",
            author: "questioner",
            created_at: "2023-01-01T00:00:00Z",
            reply_count: 0,
            like_count: 5,
            category_id: 0,
            tags: [],
          },
        ],
        category_id: 1,
        tags: ["api", "help"],
        last_posted_at: "2023-01-01T12:00:00Z",
      });
    });
  });

  describe("filterHighQualityPosts", () => {
    it("should filter posts based on engagement and content quality", () => {
      const posts = [
        {
          id: 1,
          title: "Good Post",
          content:
            "This is a substantial post with good content that should be included in the results because it has enough characters and engagement.",
          author: "user1",
          created_at: "2023-01-01T00:00:00Z",
          reply_count: 5,
          like_count: 3,
          category_id: 1,
          tags: [],
        },
        {
          id: 2,
          title: "Short Post",
          content: "Too short",
          author: "user2",
          created_at: "2023-01-01T00:00:00Z",
          reply_count: 0,
          like_count: 0,
          category_id: 1,
          tags: [],
        },
        {
          id: 3,
          title: "Deleted Post",
          content: "This post was [deleted] by the moderator",
          author: "user3",
          created_at: "2023-01-01T00:00:00Z",
          reply_count: 2,
          like_count: 1,
          category_id: 1,
          tags: [],
        },
        {
          id: 4,
          title: "Long Documentation Post",
          content:
            "This is a very long documentation post that provides detailed information about API usage and best practices. It contains comprehensive examples and explanations that would be valuable for users even though it has no engagement metrics yet because it was just posted.",
          author: "user4",
          created_at: "2023-01-01T00:00:00Z",
          reply_count: 0,
          like_count: 0,
          category_id: 1,
          tags: [],
        },
      ];

      const filtered = collector.filterHighQualityPosts(posts);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((p) => p.id)).toEqual([1, 4]);
    });

    it("should allow posts with good content but no engagement", () => {
      const posts = [
        {
          id: 1,
          title: "Documentation Post",
          content:
            "This is a comprehensive documentation post that explains how to use the OpenAI API effectively. It includes detailed examples, code snippets, and best practices that developers will find useful. Even though it has no replies or likes yet, the content quality is high and it should be included in the collection.",
          author: "moderator",
          created_at: "2023-01-01T00:00:00Z",
          reply_count: 0,
          like_count: 0,
          category_id: 1,
          tags: ["documentation", "api"],
        },
      ];

      const filtered = collector.filterHighQualityPosts(posts);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(1);
    });
  });
});
