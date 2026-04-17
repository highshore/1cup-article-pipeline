"use server";

import path from "node:path";
import { spawn } from "node:child_process";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { deleteAccessRecord, upsertAccessRecord } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { upsertReview, type ReviewStatus } from "@/lib/articles";
import { createPipelineRun } from "@/lib/runs";
import { resolveDbPath } from "@/lib/db";
import { canRunLocalPipeline } from "@/lib/runtime";

export async function updateReviewStatus(formData: FormData): Promise<void> {
  await requireUser();

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

  await upsertReview(articleId, status, note);
  revalidatePath("/");
  redirect(returnTo);
}

export async function launchPipelineRun(formData: FormData): Promise<void> {
  await requireUser();

  if (!canRunLocalPipeline()) {
    throw new Error("Pipeline launch is only available from a local dashboard runtime.");
  }

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

export async function saveAccessRecord(formData: FormData): Promise<void> {
  const { user, access } = await requireUser();

  if (!access.isSupremeLeader) {
    throw new Error("Only the supreme leader can update access records.");
  }

  const idValue = String(formData.get("id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const note = String(formData.get("note") ?? "");

  if (!["authorized", "pending", "blocked"].includes(role)) {
    throw new Error("Invalid access role.");
  }

  await upsertAccessRecord({
    id: idValue ? Number(idValue) : null,
    email,
    userId,
    role: role as "authorized" | "pending" | "blocked",
    note,
    actorUserId: user.id,
  });

  revalidatePath("/access");
  redirect("/access");
}

export async function removeAccessRecord(formData: FormData): Promise<void> {
  const { access } = await requireUser();

  if (!access.isSupremeLeader) {
    throw new Error("Only the supreme leader can delete access records.");
  }

  const id = Number(formData.get("id") ?? 0);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid access record ID.");
  }

  await deleteAccessRecord(id);
  revalidatePath("/access");
  redirect("/access");
}
