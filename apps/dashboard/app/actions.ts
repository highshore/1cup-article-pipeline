"use server";

import path from "node:path";
import { spawn } from "node:child_process";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { upsertReview, type ReviewStatus } from "@/lib/articles";
import { createPipelineRun } from "@/lib/runs";
import { resolveDbPath } from "@/lib/db";

export async function updateReviewStatus(formData: FormData): Promise<void> {
  const articleId = String(formData.get("articleId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ReviewStatus;
  const note = String(formData.get("note") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");

  if (!articleId) {
    throw new Error("Missing article ID");
  }

  if (!["pending", "approved", "deferred", "rejected"].includes(status)) {
    throw new Error("Invalid review status");
  }

  upsertReview(articleId, status, note);
  revalidatePath("/");
  redirect(returnTo);
}

export async function launchPipelineRun(formData: FormData): Promise<void> {
  const backend = String(formData.get("backend") ?? "").trim() || "gemma4";
  const inputPath = String(formData.get("inputPath") ?? "").trim();
  const outputDir = String(formData.get("outputDir") ?? "").trim();
  const skipImage = String(formData.get("skipImage") ?? "").trim() === "on";

  if (!inputPath) {
    throw new Error("Missing input path");
  }

  if (!outputDir) {
    throw new Error("Missing output directory");
  }

  const runId = createPipelineRun({
    backend,
    inputPath,
    outputDir,
    skipImage,
  });

  const scriptPath = path.resolve(process.cwd(), "scripts", "run-pipeline.mjs");
  const child = spawn(process.execPath, [scriptPath, String(runId)], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      ARTICLE_DB_PATH: resolveDbPath(),
    },
    stdio: "ignore",
  });

  child.unref();

  revalidatePath("/runs");
  redirect(`/runs?runId=${runId}`);
}
