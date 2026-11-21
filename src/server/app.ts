import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { omitStepScreenshot } from "../redact/pii.js";
import { renderGuideHtml } from "../render/html.js";
import { renderGuideMarkdown } from "../render/markdown.js";
import { parsePlaywrightTraceZip } from "../trace/parser.js";
import type { BlurBox, Guide } from "../types.js";

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const HMAC_KEY = randomBytes(32);

class PayloadTooLargeError extends Error {
  constructor(message = "Request body too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export interface TraceguideServerOptions {
  host?: string;
  port?: number;
  dbPath?: string;
  publicUrl?: string;
  apiToken?: string;
}

export interface RunningTraceguideServer {
  server: Server;
  url: string;
  port: number;
  saveGuide: (guide: Guide) => void;
  close: () => Promise<void>;
}

function timingSafeEquals(a: string, b: string): boolean {
  const ha = createHmac("sha256", HMAC_KEY).update(a, "utf8").digest();
  const hb = createHmac("sha256", HMAC_KEY).update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > maxBytes) {
      req.resume();
      throw new PayloadTooLargeError();
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isSameOrigin(req: IncomingMessage): boolean {
  const sfs = typeof req.headers["sec-fetch-site"] === "string" ? req.headers["sec-fetch-site"].toLowerCase() : "";
  if (sfs && sfs !== "same-origin" && sfs !== "none") return false;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const reqHost = (req.headers.host ?? "").toLowerCase();
      if (!reqHost || originHost !== reqHost) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function startTraceguideServer(opts: TraceguideServerOptions = {}): Promise<RunningTraceguideServer> {
  const host = opts.host ?? "127.0.0.1";
  const requestedPort = opts.port ?? 4320;
  const dbPath = opts.dbPath ?? ":memory:";
  const apiToken = opts.apiToken?.trim() || "";

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS guides (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      step_count INTEGER NOT NULL DEFAULT 0,
      redacted_total INTEGER NOT NULL DEFAULT 0,
      guide_json TEXT NOT NULL
    );
  `);

  const saveGuide = (guide: Guide): void => {
    db.prepare(
      `INSERT INTO guides (id, title, created_at, step_count, redacted_total, guide_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         step_count = excluded.step_count,
         redacted_total = excluded.redacted_total,
         guide_json = excluded.guide_json`
    ).run(guide.id, guide.title, guide.createdAt, guide.steps.length, guide.redactedTotal, JSON.stringify(guide));
  };

  const getGuide = (id: string): Guide | null => {
    const row = db.prepare("SELECT guide_json FROM guides WHERE id = ?").get(id) as { guide_json?: string } | undefined;
    if (!row?.guide_json) return null;
    return JSON.parse(row.guide_json) as Guide;
  };

  const listGuideSummaries = (): Array<{ id: string; title: string; createdAt: string; stepCount: number; redactedTotal: number }> => {
    const rows = db
      .prepare("SELECT id, title, created_at, step_count, redacted_total FROM guides ORDER BY created_at DESC")
      .all() as Array<{
      id: string;
      title: string;
      created_at: string;
      step_count: number;
      redacted_total: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      stepCount: Number(r.step_count),
      redactedTotal: Number(r.redacted_total),
    }));
  };

  let resolvedPublicBase = opts.publicUrl?.replace(/\/$/, "") || "";

  const isMutationAuthorized = (req: IncomingMessage): { ok: boolean; status: number; error: string } => {
    if (!isSameOrigin(req)) {
      return { ok: false, status: 403, error: "Cross-origin mutation rejected" };
    }
    if (apiToken) {
      const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!bearer || !timingSafeEquals(bearer, apiToken)) {
        return { ok: false, status: 401, error: "Unauthorized: valid Bearer token required" };
      }
    }
    return { ok: true, status: 200, error: "" };
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const rawUrl = req.url ?? "/";
        if (!rawUrl.startsWith("/") || rawUrl.startsWith("//") || rawUrl.startsWith("/\\")) {
          sendJson(res, 400, { error: "Bad Request" });
          return;
        }
        const parsedUrl = new URL(rawUrl, "http://traceguide.local");
        const path = parsedUrl.pathname;
        const method = (req.method ?? "GET").toUpperCase();

        if (path === "/" && method === "GET") {
          const guides = listGuideSummaries();
          const items = guides
            .map(
              (g) =>
                `<li style="padding:12px;border:1px solid #30363d;border-radius:10px;margin-bottom:8px;background:#161b22;display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <a href="/guides/${encodeURIComponent(g.id)}" style="color:#58a6ff;font-weight:700;text-decoration:none;">${escapeHtml(g.title)}</a>
                    <div style="font-size:12px;color:#8b949e;">${g.stepCount} steps | ${g.redactedTotal} PII redacted</div>
                  </div>
                  <a href="/guides/${encodeURIComponent(g.id)}/markdown" style="color:#8b949e;font-size:12px;">Markdown</a>
                </li>`
            )
            .join("");
          const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>traceguide Library</title></head>
<body style="margin:0;padding:32px;background:#0d1117;color:#e6edf3;font-family:ui-sans-serif,system-ui,sans-serif;max-width:860px;margin-inline:auto;">
  <h1 style="margin:0 0 8px 0;color:#58a6ff;">traceguide</h1>
  <p style="margin:0 0 20px 0;color:#8b949e;">Self-hosted Playwright trace.zip interactive guide library. POST a trace.zip to <code>/api/guides/upload?redact=1</code>.</p>
  <ul style="list-style:none;padding:0;margin:0;">${items || '<li style="color:#8b949e;">No guides uploaded yet.</li>'}</ul>
</body>
</html>`;
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          });
          res.end(html);
          return;
        }

        if (path === "/api/guides" && method === "GET") {
          sendJson(res, 200, listGuideSummaries());
          return;
        }

        if (path === "/api/guides/upload" && method === "POST") {
          const auth = isMutationAuthorized(req);
          if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
          }
          try {
            const zipBuf = await readBody(req, MAX_UPLOAD_BYTES);
            const title = parsedUrl.searchParams.get("title") ?? undefined;
            const redactPii = parsedUrl.searchParams.get("redact") !== "0";
            const guide = parsePlaywrightTraceZip(zipBuf, { title, redactPii, sourceFile: "upload.zip" });
            saveGuide(guide);
            sendJson(res, 201, {
              id: guide.id,
              title: guide.title,
              stepCount: guide.steps.length,
              redactedTotal: guide.redactedTotal,
              url: `/guides/${guide.id}`,
            });
          } catch (err) {
            const status = err instanceof PayloadTooLargeError ? 413 : 400;
            sendJson(res, status, { error: (err as Error).message });
          }
          return;
        }

        const guideHtmlMatch = /^\/guides\/([A-Za-z0-9_-]+)$/.exec(path);
        if (guideHtmlMatch && method === "GET") {
          const guide = getGuide(guideHtmlMatch[1]);
          if (!guide) {
            sendJson(res, 404, { error: "Guide not found" });
            return;
          }
          const nonce = randomBytes(12).toString("base64url");
          const html = renderGuideHtml(guide, {
            embedUrl: `${resolvedPublicBase}/guides/${guide.id}`,
            scriptNonce: nonce,
          });
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`,
          });
          res.end(html);
          return;
        }

        const guideMdMatch = /^\/guides\/([A-Za-z0-9_-]+)\/markdown$/.exec(path);
        if (guideMdMatch && method === "GET") {
          const guide = getGuide(guideMdMatch[1]);
          if (!guide) {
            sendJson(res, 404, { error: "Guide not found" });
            return;
          }
          const md = renderGuideMarkdown(guide);
          res.writeHead(200, {
            "Content-Type": "text/markdown; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
          });
          res.end(md);
          return;
        }

        const editStepMatch = /^\/api\/guides\/([A-Za-z0-9_-]+)\/steps\/(\d+)$/.exec(path);
        if (editStepMatch && method === "PATCH") {
          const auth = isMutationAuthorized(req);
          if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
          }
          try {
            // Read request body BEFORE loading guide from SQLite to eliminate concurrent lost-update race
            const raw = (await readBody(req, MAX_JSON_BYTES)).toString("utf8");
            const parsedPatch = JSON.parse(raw) as unknown;
            if (!parsedPatch || typeof parsedPatch !== "object" || Array.isArray(parsedPatch)) {
              sendJson(res, 400, { error: "Expected JSON object body" });
              return;
            }
            const patch = parsedPatch as { title?: unknown; detail?: unknown; blurBoxes?: unknown };
            const guide = getGuide(editStepMatch[1]);
            if (!guide) {
              sendJson(res, 404, { error: "Guide not found" });
              return;
            }
            const stepIndex = Number(editStepMatch[2]);
            const step = guide.steps.find((s) => s.index === stepIndex);
            if (!step) {
              sendJson(res, 404, { error: `Step ${stepIndex} not found` });
              return;
            }
            if (typeof patch.title === "string" && patch.title.trim()) {
              step.title = patch.title.trim().slice(0, 240);
            }
            if (typeof patch.detail === "string") {
              step.detail = patch.detail.slice(0, 1000);
            }
            if (Array.isArray(patch.blurBoxes)) {
              step.blurBoxes = patch.blurBoxes
                .filter((b): b is BlurBox => Boolean(b) && typeof b === "object")
                .slice(0, 20)
                .map((b) => ({
                  xPercent: Math.max(0, Math.min(100, Number(b.xPercent) || 0)),
                  yPercent: Math.max(0, Math.min(100, Number(b.yPercent) || 0)),
                  wPercent: Math.max(1, Math.min(100, Number(b.wPercent) || 10)),
                  hPercent: Math.max(1, Math.min(100, Number(b.hPercent) || 6)),
                  reason: typeof b.reason === "string" ? b.reason.slice(0, 60) : "manual",
                }));
            }
            saveGuide(guide);
            sendJson(res, 200, guide.screenshotsOmitted === false ? step : omitStepScreenshot(step));
          } catch (err) {
            const status = err instanceof PayloadTooLargeError ? 413 : 400;
            sendJson(res, status, { error: (err as Error).message });
          }
          return;
        }

        const delMatch = /^\/api\/guides\/([A-Za-z0-9_-]+)$/.exec(path);
        if (delMatch && method === "DELETE") {
          const auth = isMutationAuthorized(req);
          if (!auth.ok) {
            sendJson(res, auth.status, { error: auth.error });
            return;
          }
          const resDel = db.prepare("DELETE FROM guides WHERE id = ?").run(delMatch[1]);
          if (resDel.changes === 0) {
            sendJson(res, 404, { error: "Guide not found" });
            return;
          }
          sendJson(res, 200, { deleted: true, id: delMatch[1] });
          return;
        }

        sendJson(res, 404, { error: "Not found" });
      } catch {
        sendJson(res, 500, { error: "Internal server error" });
      }
    })();
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(requestedPort, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
  const url = `http://${displayHost}:${actualPort}`;
  if (!resolvedPublicBase) {
    resolvedPublicBase = url;
  }

  return {
    server,
    port: actualPort,
    url,
    saveGuide,
    close: async () => {
      server.closeIdleConnections?.();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      db.close();
    },
  };
}
