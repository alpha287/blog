import {
  posts,
  users,
  type User,
  type InsertUser,
  type Post,
  type InsertPost,
} from "@shared/schema";
import fs from "fs/promises";
import path from "path";
import { db, contactSubmissions } from "./db";
import { eq, desc, like, and, sql } from "drizzle-orm";
import type { ContactSubmission } from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getAllPosts(): Promise<Post[]>;
  getPostBySlug(slug: string): Promise<Post | undefined>;
  createPost(post: InsertPost): Promise<Post>;
  updatePost(id: number, post: Partial<InsertPost>): Promise<Post | undefined>;
  deletePost(id: number): Promise<boolean>;
  incrementViewCount(slug: string): Promise<void>;
  getPostsByTag(tag: string): Promise<Post[]>;
  searchPosts(query: string): Promise<Post[]>;
  getPostStats(): Promise<{
    totalPosts: number;
    publishedPosts: number;
    draftPosts: number;
    thisMonthPosts: number;
    totalViews: number;
    topPosts: Post[];
    tagDistribution: { [key: string]: number };
  }>;

  createContactSubmission(
    data: Omit<ContactSubmission, "id" | "createdAt" | "isRead">,
  ): Promise<ContactSubmission>;
  getAllContactSubmissions(): Promise<ContactSubmission[]>;
  markContactSubmissionAsRead(
    id: number,
  ): Promise<ContactSubmission | undefined>;
  deleteContactSubmission(id: number): Promise<boolean>;
  getUnreadContactSubmissionsCount(): Promise<number>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private posts: Map<number, Post>;
  private currentUserId: number;
  private currentPostId: number;
  private postsDir: string;
  private contactSubmissions: Map<number, ContactSubmission>;
  private currentContactSubmissionId: number;

  constructor() {
    this.users = new Map();
    this.posts = new Map();
    this.currentUserId = 1;
    this.currentPostId = 1;
    this.postsDir = path.join(process.cwd(), "posts");
    this.contactSubmissions = new Map();
    this.currentContactSubmissionId = 1;
    this.initializeStorage();
  }

  private async initializeStorage() {
    // Create posts directory if it doesn't exist
    try {
      await fs.mkdir(this.postsDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }

    // Load existing posts from markdown files
    await this.loadPostsFromFiles();
  }

  private async loadPostsFromFiles() {
    try {
      const files = await fs.readdir(this.postsDir);
      const markdownFiles = files.filter((file) => file.endsWith(".md"));

      for (const file of markdownFiles) {
        const filePath = path.join(this.postsDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const slug = file.replace(".md", "");

        // Parse frontmatter and content
        const { title, excerpt, readTime, category, tags, status, markdown } =
          this.parseMarkdownFile(content);

        const post: Post = {
          id: this.currentPostId++,
          title,
          slug,
          content: markdown,
          excerpt,
          readTime,
          category,
          tags,
          status,
          viewCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        this.posts.set(post.id, post);
      }
    } catch (error) {
      console.error("Error loading posts from files:", error);
    }
  }

  private parseMarkdownFile(content: string): {
    title: string;
    excerpt: string;
    readTime: string;
    category: string;
    tags: string[];
    status: string;
    markdown: string;
  } {
    // Simple frontmatter parser
    const lines = content.split("\n");
    let title = "Untitled";
    let excerpt = "";
    let readTime = "5 min read";
    let category = "General";
    let tags: string[] = [];
    let status = "published";
    let markdown = content;

    if (lines[0] === "---") {
      const endIndex = lines.findIndex(
        (line, index) => index > 0 && line === "---",
      );
      if (endIndex > 0) {
        const frontmatter = lines.slice(1, endIndex);
        markdown = lines.slice(endIndex + 1).join("\n");

        frontmatter.forEach((line) => {
          const [key, ...valueParts] = line.split(":");
          const value = valueParts.join(":").trim();

          switch (key.trim()) {
            case "title":
              title = value;
              break;
            case "excerpt":
              excerpt = value;
              break;
            case "readTime":
              readTime = value;
              break;
            case "category":
              category = value;
              break;
            case "tags":
              tags = value
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
              break;
            case "status":
              status = value;
              break;
          }
        });
      }
    }

    // Generate excerpt from content if not provided
    if (!excerpt) {
      const firstParagraph = markdown
        .split("\n")
        .find((line) => line.trim().length > 0);
      excerpt = firstParagraph ? firstParagraph.substring(0, 150) + "..." : "";
    }

    return { title, excerpt, readTime, category, tags, status, markdown };
  }

  private async savePostToFile(post: Post) {
    const frontmatter = `---
title: ${post.title}
excerpt: ${post.excerpt}
readTime: ${post.readTime}
category: ${post.category}
tags: ${post.tags?.join(", ") || ""}
status: ${post.status}
---

${post.content}`;

    const filePath = path.join(this.postsDir, `${post.slug}.md`);
    await fs.writeFile(filePath, frontmatter, "utf-8");
  }

  private async deletePostFile(slug: string) {
    const filePath = path.join(this.postsDir, `${slug}.md`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error("Error deleting post file:", error);
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAllPosts(): Promise<Post[]> {
    return Array.from(this.posts.values())
      .filter((post) => post.status === "published")
      .sort(
        (a, b) =>
          new Date(b.createdAt || new Date()).getTime() -
          new Date(a.createdAt || new Date()).getTime(),
      );
  }

  async getPostBySlug(slug: string): Promise<Post | undefined> {
    return Array.from(this.posts.values()).find((post) => post.slug === slug);
  }

  async createPost(insertPost: InsertPost): Promise<Post> {
    const id = this.currentPostId++;
    const post: Post = {
      title: insertPost.title,
      slug: insertPost.slug,
      content: insertPost.content,
      excerpt: insertPost.excerpt || null,
      readTime: insertPost.readTime || null,
      category: insertPost.category || null,
      tags: insertPost.tags || null,
      status: insertPost.status || "published",
      viewCount: 0,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.posts.set(id, post);
    await this.savePostToFile(post);
    return post;
  }

  async updatePost(
    id: number,
    updateData: Partial<InsertPost>,
  ): Promise<Post | undefined> {
    const existingPost = this.posts.get(id);
    if (!existingPost) return undefined;

    const updatedPost: Post = {
      ...existingPost,
      ...updateData,
      updatedAt: new Date(),
    };

    this.posts.set(id, updatedPost);
    await this.savePostToFile(updatedPost);
    return updatedPost;
  }

  async deletePost(id: number): Promise<boolean> {
    const post = this.posts.get(id);
    if (!post) return false;

    this.posts.delete(id);
    await this.deletePostFile(post.slug);
    return true;
  }

  async incrementViewCount(slug: string): Promise<void> {
    const post = Array.from(this.posts.values()).find((p) => p.slug === slug);
    if (post) {
      post.viewCount = (post.viewCount || 0) + 1;
      await this.savePostToFile(post);
    }
  }

  async getPostsByTag(tag: string): Promise<Post[]> {
    return Array.from(this.posts.values())
      .filter((post) => post.status === "published" && post.tags?.includes(tag))
      .sort(
        (a, b) =>
          new Date(b.createdAt || new Date()).getTime() -
          new Date(a.createdAt || new Date()).getTime(),
      );
  }

  async searchPosts(query: string): Promise<Post[]> {
    const searchTerm = query.toLowerCase();
    return Array.from(this.posts.values())
      .filter(
        (post) =>
          post.status === "published" &&
          (post.title.toLowerCase().includes(searchTerm) ||
            post.content.toLowerCase().includes(searchTerm) ||
            post.excerpt?.toLowerCase().includes(searchTerm)),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt || new Date()).getTime() -
          new Date(a.createdAt || new Date()).getTime(),
      );
  }

  async getPostStats(): Promise<{
    totalPosts: number;
    publishedPosts: number;
    draftPosts: number;
    thisMonthPosts: number;
    totalViews: number;
    topPosts: Post[];
    tagDistribution: { [key: string]: number };
  }> {
    const allPosts = Array.from(this.posts.values());
    const publishedPosts = allPosts.filter((p) => p.status === "published");
    const draftPosts = allPosts.filter((p) => p.status === "draft");

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthPosts = allPosts.filter(
      (p) => p.createdAt && new Date(p.createdAt) >= thisMonth,
    );

    const totalViews = allPosts.reduce(
      (sum, post) => sum + (post.viewCount || 0),
      0,
    );

    const topPosts = [...publishedPosts]
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 5);

    const tagDistribution: { [key: string]: number } = {};
    publishedPosts.forEach((post) => {
      post.tags?.forEach((tag) => {
        tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
      });
    });

    return {
      totalPosts: allPosts.length,
      publishedPosts: publishedPosts.length,
      draftPosts: draftPosts.length,
      thisMonthPosts: thisMonthPosts.length,
      totalViews,
      topPosts,
      tagDistribution,
    };
  }

  async createContactSubmission(
    data: Omit<ContactSubmission, "id" | "createdAt" | "isRead">,
  ): Promise<ContactSubmission> {
    const id = this.currentContactSubmissionId++;
    const submission: ContactSubmission = {
      id: id,
      name: data.name,
      email: data.email,
      subject: data.subject,
      message: data.message,
      createdAt: new Date(),
      isRead: false,
    };
    this.contactSubmissions.set(id, submission);
    return submission;
  }

  async getAllContactSubmissions(): Promise<ContactSubmission[]> {
    return Array.from(this.contactSubmissions.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async markContactSubmissionAsRead(
    id: number,
  ): Promise<ContactSubmission | undefined> {
    const submission = this.contactSubmissions.get(id);
    if (submission) {
      submission.isRead = true;
      this.contactSubmissions.set(id, submission);
      return submission;
    }
    return undefined;
  }

  async deleteContactSubmission(id: number): Promise<boolean> {
    return this.contactSubmissions.delete(id);
  }

  async getUnreadContactSubmissionsCount(): Promise<number> {
    let count = 0;
    this.contactSubmissions.forEach((submission) => {
      if (!submission.isRead) {
        count++;
      }
    });
    return count;
  }
}

export class DatabaseStorage implements IStorage {
  private postsDir: string;

  constructor() {
    this.postsDir = path.join(process.cwd(), "posts");
    this.initializeStorage();
  }

  private async initializeStorage() {
    try {
      await this.loadPostsFromFiles();
    } catch (error) {
      console.error("Error initializing storage:", error);
    }
  }

  private async loadPostsFromFiles() {
    try {
      const files = await fs.readdir(this.postsDir);
      const markdownFiles = files.filter((file) => file.endsWith(".md"));

      for (const file of markdownFiles) {
        const filePath = path.join(this.postsDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const slug = file.replace(".md", "");

        // Check if post already exists in database
        const existingPost = await db
          .select()
          .from(posts)
          .where(eq(posts.slug, slug))
          .limit(1);

        if (existingPost.length === 0) {
          const parsed = this.parseMarkdownFile(content);
          const post: InsertPost = {
            title: parsed.title,
            slug: slug,
            content: parsed.markdown,
            excerpt: parsed.excerpt,
            readTime: parsed.readTime,
            category: parsed.category,
            tags: parsed.tags,
            status: parsed.status as "published" | "draft",
            viewCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await db.insert(posts).values(post);
        }
      }
    } catch (error) {
      console.error("Error loading posts from files:", error);
    }
  }

  private parseMarkdownFile(content: string): {
    title: string;
    excerpt: string;
    readTime: string;
    category: string;
    tags: string[];
    status: string;
    markdown: string;
  } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return {
        title: "Untitled",
        excerpt: "No excerpt available",
        readTime: "5 min read",
        category: "General",
        tags: [],
        status: "published",
        markdown: content,
      };
    }

    const frontmatter = match[1];
    const markdown = match[2];

    const parseValue = (key: string, defaultValue: any) => {
      const regex = new RegExp(`^${key}:\\s*(.*)$`, "m");
      const match = frontmatter.match(regex);
      return match ? match[1].trim() : defaultValue;
    };

    const tagsStr = parseValue("tags", "");
    const tags = tagsStr
      ? tagsStr.split(",").map((tag: string) => tag.trim())
      : [];

    return {
      title: parseValue("title", "Untitled"),
      excerpt: parseValue("excerpt", "No excerpt available"),
      readTime: parseValue("readTime", "5 min read"),
      category: parseValue("category", "General"),
      tags: tags,
      status: parseValue("status", "published"),
      markdown: markdown,
    };
  }

  private async savePostToFile(post: Post) {
    try {
      const frontmatter = `---
title: ${post.title}
excerpt: ${post.excerpt || ""}
readTime: ${post.readTime || ""}
category: ${post.category || ""}
tags: ${post.tags?.join(", ") || ""}
status: ${post.status}
---

${post.content}`;

      const filePath = path.join(this.postsDir, `${post.slug}.md`);
      await fs.writeFile(filePath, frontmatter, "utf-8");
    } catch (error) {
      console.error("Error saving post to file:", error);
      throw new Error("Failed to save post file");
    }
  }

  private async deletePostFile(slug: string) {
    const filePath = path.join(this.postsDir, `${slug}.md`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error("Error deleting post file:", error);
    }
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllPosts(): Promise<Post[]> {
    return await db.select().from(posts).orderBy(desc(posts.createdAt));
  }

  async getPostBySlug(slug: string): Promise<Post | undefined> {
    const [post] = await db.select().from(posts).where(eq(posts.slug, slug));
    return post || undefined;
  }

  async createPost(insertPost: InsertPost): Promise<Post> {
    const [post] = await db.insert(posts).values(insertPost).returning();
    await this.savePostToFile(post);
    return post;
  }

  async updatePost(
    id: number,
    updateData: Partial<InsertPost>,
  ): Promise<Post | undefined> {
    const [post] = await db
      .update(posts)
      .set(updateData)
      .where(eq(posts.id, id))
      .returning();
    if (post) {
      await this.savePostToFile(post);
    }
    return post || undefined;
  }

  async deletePost(id: number): Promise<boolean> {
    const post = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (post.length > 0) {
      await this.deletePostFile(post[0].slug);
      await db.delete(posts).where(eq(posts.id, id));
      return true;
    }
    return false;
  }

  async incrementViewCount(slug: string): Promise<void> {
    await db
      .update(posts)
      .set({
        viewCount: sql`${posts.viewCount} + 1`,
      })
      .where(eq(posts.slug, slug));
  }

  async getPostsByTag(tag: string): Promise<Post[]> {
    return await db
      .select()
      .from(posts)
      .where(
        and(
          sql`${posts.tags} @> ARRAY[${tag}]::text[]`,
          eq(posts.status, "published"),
        ),
      )
      .orderBy(desc(posts.createdAt));
  }

  async searchPosts(query: string): Promise<Post[]> {
    return await db
      .select()
      .from(posts)
      .where(
        and(
          sql`(${posts.title} ILIKE ${"%" + query + "%"} OR ${posts.content} ILIKE ${"%" + query + "%"})`,
          eq(posts.status, "published"),
        ),
      )
      .orderBy(desc(posts.createdAt));
  }

  async getPostStats(): Promise<{
    totalPosts: number;
    publishedPosts: number;
    draftPosts: number;
    thisMonthPosts: number;
    totalViews: number;
    topPosts: Post[];
    tagDistribution: { [key: string]: number };
  }> {
    const allPosts = await db.select().from(posts);
    const publishedPosts = allPosts.filter((p) => p.status === "published");
    const draftPosts = allPosts.filter((p) => p.status === "draft");

    const thisMonth = new Date();
    thisMonth.setMonth(thisMonth.getMonth() - 1);
    const thisMonthPosts = allPosts.filter(
      (p) => p.createdAt && p.createdAt >= thisMonth,
    );

    const totalViews = allPosts.reduce(
      (sum, post) => sum + (post.viewCount || 0),
      0,
    );

    const topPosts = publishedPosts
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 5);

    const tagDistribution: { [key: string]: number } = {};
    allPosts.forEach((post) => {
      if (post.tags) {
        post.tags.forEach((tag) => {
          tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
        });
      }
    });

    return {
      totalPosts: allPosts.length,
      publishedPosts: publishedPosts.length,
      draftPosts: draftPosts.length,
      thisMonthPosts: thisMonthPosts.length,
      totalViews,
      topPosts,
      tagDistribution,
    };
  }

  async createContactSubmission(
    data: Omit<ContactSubmission, "id" | "createdAt" | "isRead">,
  ): Promise<ContactSubmission> {
    try {
      const [result] = await db
        .insert(contactSubmissions)
        .values({
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          createdAt: new Date(),
          isRead: false,
        })
        .returning();

      return result;
    } catch (error) {
      console.error("Error creating contact submission:", error);
      throw new Error("Failed to create contact submission");
    }
  }

  async getAllContactSubmissions(): Promise<ContactSubmission[]> {
    try {
      return await db
        .select()
        .from(contactSubmissions)
        .orderBy(desc(contactSubmissions.createdAt));
    } catch (error) {
      console.error("Error fetching contact submissions:", error);
      throw new Error("Failed to fetch contact submissions");
    }
  }

  async markContactSubmissionAsRead(
    id: number,
  ): Promise<ContactSubmission | undefined> {
    const [result] = await db
      .update(contactSubmissions)
      .set({ isRead: true })
      .where(eq(contactSubmissions.id, id))
      .returning();

    return result || undefined;
  }

  async deleteContactSubmission(id: number): Promise<boolean> {
    try {
      const result = await db
        .delete(contactSubmissions)
        .where(eq(contactSubmissions.id, id));

      return (result as any).rowCount > 0;
    } catch (error) {
      console.error("Error deleting contact submission:", error);
      throw new Error("Failed to delete contact submission");
    }
  }

  async getUnreadContactSubmissionsCount(): Promise<number> {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(contactSubmissions)
        .where(eq(contactSubmissions.isRead, false));

      return result[0]?.count || 0;
    } catch (error) {
      console.error("Error fetching unread contact submissions count:", error);
      throw new Error("Failed to fetch unread contact submissions count");
    }
  }
}




export const storage = new DatabaseStorage();
