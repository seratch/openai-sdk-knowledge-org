import { RateLimiter, RateLimitConfig } from "@/rate-limiter";
import { Logger } from "@/logger";

export interface DiscourseCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  topic_count: number;
}

export interface ForumPost {
  id: number;
  title: string;
  content: string;
  author: string;
  created_at: string;
  category_id: number;
  reply_count: number;
  like_count: number;
  tags: string[];
}

export interface TopicDetails {
  id: number;
  title: string;
  posts: ForumPost[];
  category_id: number;
  tags: string[];
  last_posted_at?: string;
}

export interface ForumCollector {
  fetchCategories(): Promise<DiscourseCategory[]>;
  fetchCategoryPosts(
    categorySlug: string,
    page: number,
    since?: string,
  ): Promise<ForumPost[]>;
  fetchCategoryPostsWithId(
    categorySlug: string,
    categoryId: number,
    page: number,
    since?: string,
  ): Promise<ForumPost[]>;
  fetchLatestPosts(page: number, since?: string): Promise<ForumPost[]>;
  fetchTopPosts(page: number, period?: string): Promise<ForumPost[]>;
  searchPosts(query: string, page: number): Promise<ForumPost[]>;
  fetchMultiplePages<T>(
    fetchFunction: (page: number) => Promise<T[]>,
    maxPages: number,
    maxItems: number,
  ): Promise<T[]>;
  fetchTopicDetails(topicId: number): Promise<TopicDetails>;
  filterHighQualityPosts(posts: ForumPost[]): ForumPost[];
}

const USER_AGENT = "seratch/openai-sdk-data-collector 0.1";

export class ForumCollectorImpl implements ForumCollector {
  private rateLimiter: RateLimiter;

  constructor(private baseUrl: string = "https://community.openai.com") {
    const rateLimitConfig: RateLimitConfig = {
      requestsPerMinute: 8,
      retryAttempts: 3,
      baseDelayMs: 8000,
    };
    this.rateLimiter = new RateLimiter(rateLimitConfig);
  }

  async fetchCategories(): Promise<DiscourseCategory[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(() => `Fetching forum categories from: ${this.baseUrl}`);
      const response = await fetch(`${this.baseUrl}/categories.json`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const categories =
        data.category_list?.categories?.map(this.transformToCategory) || [];
      Logger.lazyDebug(
        () =>
          `Fetched categories: ${JSON.stringify({ count: categories.length })}`,
      );
      return categories;
    });
  }

  async fetchCategoryPosts(
    categorySlug: string,
    page: number = 1,
    since?: string,
  ): Promise<ForumPost[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () =>
          `Fetching category posts: ${JSON.stringify({ categorySlug, page, since })}`,
      );

      const categories = await this.fetchCategories();
      const category = categories.find((cat) => cat.slug === categorySlug);

      if (!category) {
        Logger.warn(
          `Category with slug '${categorySlug}' not found. Available categories:`,
          categories.map((c) => c.slug),
        );
        return [];
      }

      return this.fetchCategoryPostsWithId(
        categorySlug,
        category.id,
        page,
        since,
      );
    });
  }

  async fetchCategoryPostsWithId(
    categorySlug: string,
    categoryId: number,
    page: number = 1,
    since?: string,
  ): Promise<ForumPost[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () =>
          `Fetching category posts with ID: ${JSON.stringify({
            categorySlug,
            categoryId,
            page,
            since,
          })}`,
      );

      let url = `${this.baseUrl}/c/${categorySlug}/${categoryId}.json?page=${page}`;
      if (since) {
        url += `&before=${since}`;
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const posts =
        data.topic_list?.topics?.map(this.transformToForumPost) || [];
      Logger.lazyDebug(
        () =>
          `Fetched category posts: ${JSON.stringify({
            categorySlug,
            categoryId,
            page,
            count: posts.length,
          })}`,
      );
      return posts;
    });
  }

  async fetchLatestPosts(
    page: number = 1,
    since?: string,
  ): Promise<ForumPost[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () => `Fetching latest posts: ${JSON.stringify({ page, since })}`,
      );

      let url = `${this.baseUrl}/latest.json?page=${page}`;
      if (since) {
        url += `&before=${since}`;
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const posts =
        data.topic_list?.topics?.map(this.transformToForumPost) || [];
      Logger.lazyDebug(
        () =>
          `Fetched latest posts: ${JSON.stringify({ page, count: posts.length })}`,
      );
      return posts;
    });
  }

  async fetchTopPosts(
    page: number = 1,
    period: string = "monthly",
  ): Promise<ForumPost[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () => `Fetching top posts: ${JSON.stringify({ page, period })}`,
      );

      const url = `${this.baseUrl}/top.json?page=${page}&period=${period}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const posts =
        data.topic_list?.topics?.map(this.transformToForumPost) || [];
      Logger.lazyDebug(
        () =>
          `Fetched top posts: ${JSON.stringify({ page, period, count: posts.length })}`,
      );
      return posts;
    });
  }

  async searchPosts(query: string, page: number = 1): Promise<ForumPost[]> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      Logger.lazyDebug(
        () => `Searching posts: ${JSON.stringify({ query, page })}`,
      );

      const url = `${this.baseUrl}/search/query.json?term=${encodeURIComponent(query)}&page=${page}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const posts = data.topics?.map(this.transformToForumPost) || [];
      Logger.lazyDebug(
        () =>
          `Searched posts: ${JSON.stringify({ query, page, count: posts.length })}`,
      );
      return posts;
    });
  }

  async fetchMultiplePages<T>(
    fetchFunction: (page: number) => Promise<T[]>,
    maxPages: number = 20,
    maxItems: number = 500,
  ): Promise<T[]> {
    const allItems: T[] = [];

    for (let page = 1; page <= maxPages && allItems.length < maxItems; page++) {
      const items = await fetchFunction(page);
      if (items.length === 0) break;
      allItems.push(...items);
      Logger.lazyDebug(
        () =>
          `Fetched page ${page}: ${items.length} items, total: ${allItems.length}`,
      );
    }

    return allItems.slice(0, maxItems);
  }

  async fetchTopicDetails(topicId: number): Promise<TopicDetails> {
    return this.rateLimiter.executeWithRateLimit(async () => {
      const response = await fetch(`${this.baseUrl}/t/${topicId}.json`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;

      return {
        id: data.id,
        title: data.title || data.fancy_title || "",
        posts:
          data.post_stream?.posts?.map((post: any) =>
            this.transformPost(post),
          ) || [],
        category_id: data.category_id || 0,
        tags: data.tags || [],
        last_posted_at: data.last_posted_at,
      };
    });
  }

  filterHighQualityPosts(posts: ForumPost[]): ForumPost[] {
    Logger.lazyDebug(() => `Filtering ${posts.length} posts for quality`);

    return posts.filter((post) => {
      const hasMinimumEngagement = post.reply_count > 0 || post.like_count > 0;
      const hasSubstantialContent = post.content.length > 50;
      const isNotDeleted = !post.content.includes("[deleted]");
      const hasGoodContent = post.content.length > 200;

      Logger.lazyDebug(
        () =>
          `Post ${post.id}: engagement=${hasMinimumEngagement} (replies=${post.reply_count}, likes=${post.like_count}), content_length=${post.content.length}, not_deleted=${isNotDeleted}, good_content=${hasGoodContent}`,
      );

      const passes =
        (hasMinimumEngagement && hasSubstantialContent && isNotDeleted) ||
        (hasGoodContent && isNotDeleted);

      if (!passes) {
        Logger.lazyDebug(
          () =>
            `Post ${post.id} filtered out: "${post.title}" - content preview: "${post.content.substring(0, 50)}..."`,
        );
      }

      return passes;
    });
  }

  private transformToCategory(category: any): DiscourseCategory {
    return {
      id: category.id || 0,
      name: category.name || "",
      slug: category.slug || "",
      description: category.description || "",
      topic_count: category.topic_count || 0,
    };
  }

  private transformToForumPost(topic: any): ForumPost {
    const title = topic.title || topic.fancy_title || "";
    const excerpt = topic.excerpt || "";
    const content =
      title && excerpt ? `${title}\n\n${excerpt}` : title || excerpt;

    return {
      id: topic.id || 0,
      title: title,
      content: content,
      author: topic.last_poster_username || "unknown",
      created_at: topic.created_at || new Date().toISOString(),
      reply_count: topic.reply_count || 0,
      like_count: topic.like_count || 0,
      category_id: topic.category_id || 0,
      tags: topic.tags || [],
    };
  }

  private transformPost(post: any): ForumPost {
    return {
      id: post.id || 0,
      title: post.title || "",
      content: this.cleanPostContent(post.cooked || post.raw || ""),
      author: post.username || "unknown",
      created_at: post.created_at || new Date().toISOString(),
      reply_count: 0,
      like_count: post.score || 0,
      category_id: 0,
      tags: [],
    };
  }

  private cleanPostContent(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }
}
