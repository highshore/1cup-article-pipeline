import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get("path");

  if (!rawPath) {
    return new Response("Missing path", { status: 400 });
  }

  const resolvedPath = path.resolve(REPO_ROOT, rawPath);
  const relativePath = path.relative(REPO_ROOT, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return new Response("Invalid path", { status: 400 });
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(resolvedPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(fileBuffer), {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": contentTypeFor(resolvedPath),
    },
  });
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
