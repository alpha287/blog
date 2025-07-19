import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertPostSchema,
  updatePostSchema,
  contactSubmissionSchema,
} from "@shared/schema";
import { z } from "zod";
import express from "express";

const adminPasswordSchema = z.object({
  password: z.string(),
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all posts
  app.get("/api/posts", async (req, res) => {
    try {
      const posts = await storage.getAllPosts();
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  });

  // Get post by slug
  app.get("/api/posts/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const post = await storage.getPostBySlug(slug);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Increment view count
      await storage.incrementViewCount(slug);

      res.json(post);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch post" });
    }
  });

  // Search posts
  app.get("/api/posts/search/:query", async (req, res) => {
    try {
      const { query } = req.params;
      const posts = await storage.searchPosts(query);
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: "Failed to search posts" });
    }
  });

  // Get posts by tag
  app.get("/api/posts/tag/:tag", async (req, res) => {
    try {
      const { tag } = req.params;
      const posts = await storage.getPostsByTag(tag);
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch posts by tag" });
    }
  });

  // Admin authentication
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { password } = adminPasswordSchema.parse(req.body);

      if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
      } else {
        res.status(401).json({ error: "Invalid password" });
      }
    } catch (error) {
      res.status(400).json({ error: "Invalid request" });
    }
  });

  // Create new post (admin only)
  app.post("/api/admin/posts", async (req, res) => {
    try {
      const postData = insertPostSchema.parse(req.body);

      // Generate slug if not provided
      if (!postData.slug) {
        postData.slug = postData.title
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/--+/g, "-")
          .trim();
      }

      // Check if slug already exists
      const existingPost = await storage.getPostBySlug(postData.slug);
      if (existingPost) {
        return res
          .status(400)
          .json({ error: "Post with this slug already exists" });
      }

      const post = await storage.createPost(postData);
      res.json(post);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid post data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create post" });
      }
    }
  });

  // Update post (admin only)
  app.put("/api/admin/posts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const postData = updatePostSchema.parse({
        ...req.body,
        id: parseInt(id),
      });

      const updatedPost = await storage.updatePost(parseInt(id), postData);

      if (!updatedPost) {
        return res.status(404).json({ error: "Post not found" });
      }

      res.json(updatedPost);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid post data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update post" });
      }
    }
  });

  // Delete post (admin only)
  app.delete("/api/admin/posts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deletePost(parseInt(id));

      if (!success) {
        return res.status(404).json({ error: "Post not found" });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete post" });
    }
  });

  // Get admin stats
  app.get("/api/admin/stats", async (req, res) => {
    try {
      const stats = await storage.getPostStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Contact form submission
  app.post("/api/contact", async (req, res) => {
    try {
      const contactData = contactSubmissionSchema.parse(req.body);

      console.log("Contact form submission:", contactData);

      const submission = await storage.createContactSubmission(contactData);

      res.json({ success: true, message: "Message sent successfully" });
    } catch (error) {
      console.error("Error in contact form submission:", error);
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid contact data", details: error.errors });
      } else {
        res
          .status(500)
          .json({ error: "Failed to send message", details: error.message });
      }
    }
  });

  // Get all contact submissions (admin only)
  app.get("/api/admin/contact-submissions", async (req, res) => {
    try {
      const submissions = await storage.getAllContactSubmissions();
      res.json(submissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch contact submissions" });
    }
  });

  // Mark contact submission as read (admin only)
  app.patch("/api/admin/contact-submissions/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      const submission = await storage.markContactSubmissionAsRead(
        parseInt(id),
      );

      if (!submission) {
        return res.status(404).json({ error: "Contact submission not found" });
      }

      res.json(submission);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark submission as read" });
    }
  });

  // Delete contact submission (admin only)
  app.delete("/api/admin/contact-submissions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteContactSubmission(parseInt(id));

      if (!success) {
        return res.status(404).json({ error: "Contact submission not found" });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete contact submission" });
    }
  });

  // Get unread contact submissions count (admin only)
  app.get("/api/admin/contact-submissions/unread-count", async (req, res) => {
    try {
      const count = await storage.getUnreadContactSubmissionsCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // Serve TinyMCE assets
  app.use("/tinymce", express.static("node_modules/tinymce"));

  const httpServer = createServer(app);
  return httpServer;
}
