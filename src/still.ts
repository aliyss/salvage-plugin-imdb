/**
 * A still is the heaviest part of an episode list and the slowest to fetch, so
 * each one is kept in the plugin's own folder the first time it is seen. The
 * helper serves those files back from this computer, which is what keeps the
 * browser from ever asking m.media-amazon.com for a picture — and what makes a
 * second open of the same list draw its pictures without a request.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;
/** Enough of a sha256 to name one picture, and no more. */
const HASH_CHARS = 32;
/** Pictures are fetched a few at a time, so a long season does not flood. */
const CONCURRENCY = 4;
const EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];

function mediaDirectory(): string {
  return join(process.env.SALVAGE_PLUGIN_DATA ?? ".", "media");
}

function extensionOf(pathname: string): string | null {
  const last = pathname.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS.includes(last) ? last : null;
}

/** The name one picture is filed under: a hash of its address, then its kind. */
export function stillName(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  const extension = extensionOf(parsed.pathname);
  if (!extension) {
    return null;
  }
  const hash = createHash("sha256").update(url).digest("hex");
  return `${hash.slice(0, HASH_CHARS)}.${extension}`;
}

async function filed(name: string): Promise<boolean> {
  try {
    await stat(join(mediaDirectory(), name));
    return true;
  } catch {
    return false;
  }
}

/** Files one picture here, answering the name it is filed under. */
export async function keepStill(url: string | null): Promise<string | null> {
  const name = url ? stillName(url) : null;
  if (!url || !name) {
    return null;
  }
  if (await filed(name)) {
    return name;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!(response.headers.get("content-type") ?? "").startsWith("image/")) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      return null;
    }
    await mkdir(mediaDirectory(), { recursive: true });
    // Written beside its name and moved into place, so a process killed
    // mid-write — the helper answers a plugin and exits — never leaves a
    // half-written picture that later reads as one that is already filed.
    const part = join(mediaDirectory(), `${name}.part`);
    await writeFile(part, bytes).catch(() => undefined);
    await rename(part, join(mediaDirectory(), name)).catch(() => undefined);
    return name;
  } catch {
    // A picture that cannot be kept leaves the row without one.
    return null;
  }
}

/** Files a whole list's pictures, a few at a time, in the same order. */
export async function keepStills(
  urls: (string | null)[],
): Promise<(string | null)[]> {
  const names: (string | null)[] = urls.map(() => null);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= urls.length) {
        return;
      }
      names[index] = await keepStill(urls[index] ?? null);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker),
  );
  return names;
}
