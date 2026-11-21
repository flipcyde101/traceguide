import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoPlaywrightTraceZip } from "./demo/fixture.js";
import { renderGuideHtml } from "./render/html.js";
import { renderGuideMarkdown } from "./render/markdown.js";
import { startTraceguideServer } from "./server/app.js";
import { parsePlaywrightTraceZip } from "./trace/parser.js";

export interface ParsedCliArgs {
  mode: "help" | "build" | "serve" | "demo";
  tracePath?: string;
  outPath: string;
  markdownPath?: string;
  title?: string;
  redactPii: boolean;
  host: string;
  port: number;
  dbPath?: string;
  publicUrl?: string;
  apiToken?: string;
}

function printHelp(): void {
  console.log(`traceguide v0.1.1 - Turn Playwright trace.zip files into self-hosted interactive guides (OSS Scribe/Arcade)

Usage:
  traceguide build <trace.zip> [options]   Compile Playwright trace.zip into interactive HTML + Markdown
  traceguide serve [options]               Run self-hosted SQLite guide library server (default: 127.0.0.1:4320)
  traceguide --demo [options]              Compile a built-in Playwright trace.zip with PII redaction into ./traceguide-demo.html

Options:
  --out <file.html>                        Output interactive HTML path (default: ./guide.html)
  --markdown <file.md>                     Also write Markdown guide to <file.md>
  --title <text>                           Custom guide title
  --redact-pii                             Scrub known PII patterns and omit all screenshots (default: on)
  --no-redact-pii                          Keep original text and screenshots. Use only with safe traces.
  --host <addr>                            Bind host for serve (default: 127.0.0.1)
  --port <n>                               Listen port for serve (default: 4320)
  --db <path>                              SQLite database path for serve (default: ~/.traceguide/traceguide.db)
  --public-url <url>                       Public base URL for generated iframe embed snippets
  --token <secret>                         Optional Bearer API token for upload/edit/delete (or env TRACEGUIDE_API_TOKEN)
  -h, --help                               Show this help`);
}

function requireVal(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || !v.trim() || v.trim().startsWith("-")) {
    throw new Error(`Missing or empty value for ${flag}`);
  }
  return v.trim();
}

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    mode: "help",
    outPath: "./guide.html",
    redactPii: true,
    host: env.TRACEGUIDE_HOST?.trim() || "127.0.0.1",
    port: 4320,
    dbPath: env.TRACEGUIDE_DB?.trim() || undefined,
    publicUrl: env.TRACEGUIDE_PUBLIC_URL?.trim() || undefined,
    apiToken: env.TRACEGUIDE_API_TOKEN?.trim() || undefined,
  };

  if (env.TRACEGUIDE_PORT?.trim()) {
    if (!/^\d+$/.test(env.TRACEGUIDE_PORT.trim())) throw new Error("TRACEGUIDE_PORT must be an integer 0..65535");
    const ep = Number(env.TRACEGUIDE_PORT.trim());
    if (ep < 0 || ep > 65535) throw new Error("TRACEGUIDE_PORT must be an integer 0..65535");
    parsed.port = ep;
  }

  let explicitMode: ParsedCliArgs["mode"] | null = null;
  let explicitOut = false;

  const setMode = (m: ParsedCliArgs["mode"]): void => {
    if (explicitMode && explicitMode !== m) {
      throw new Error(`Conflicting modes: "${explicitMode}" and "${m}" cannot be combined.`);
    }
    explicitMode = m;
    parsed.mode = m;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      parsed.mode = "help";
      return parsed;
    } else if (arg === "build") {
      setMode("build");
    } else if (arg === "serve") {
      setMode("serve");
    } else if (arg === "--demo") {
      setMode("demo");
      if (!explicitOut) parsed.outPath = "./traceguide-demo.html";
    } else if (arg === "--out") {
      parsed.outPath = requireVal(argv, i, "--out");
      explicitOut = true;
      i++;
    } else if (arg === "--markdown") {
      parsed.markdownPath = requireVal(argv, i, "--markdown");
      i++;
    } else if (arg === "--title") {
      parsed.title = requireVal(argv, i, "--title");
      i++;
    } else if (arg === "--redact-pii") {
      parsed.redactPii = true;
    } else if (arg === "--no-redact-pii") {
      parsed.redactPii = false;
    } else if (arg === "--host") {
      parsed.host = requireVal(argv, i, "--host");
      i++;
    } else if (arg === "--port") {
      const raw = requireVal(argv, i, "--port");
      if (!/^\d+$/.test(raw)) throw new Error("--port must be an integer 0..65535");
      const p = Number(raw);
      if (p < 0 || p > 65535) throw new Error("--port must be an integer 0..65535");
      parsed.port = p;
      i++;
    } else if (arg === "--db") {
      parsed.dbPath = requireVal(argv, i, "--db");
      i++;
    } else if (arg === "--public-url") {
      parsed.publicUrl = requireVal(argv, i, "--public-url");
      i++;
    } else if (arg === "--token") {
      parsed.apiToken = requireVal(argv, i, "--token");
      i++;
    } else if (parsed.mode === "build" && !arg.startsWith("-") && !parsed.tracePath) {
      parsed.tracePath = arg;
    } else {
      throw new Error(`Unknown argument "${arg}". Run \`traceguide --help\`.`);
    }
  }

  if (parsed.mode === "build" && !parsed.tracePath) {
    throw new Error("Missing <trace.zip> path. Usage: traceguide build <trace.zip> --out guide.html");
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.mode === "help") {
    printHelp();
    return;
  }

  if (args.mode === "serve") {
    const dbPath = args.dbPath ?? join(homedir(), ".traceguide", "traceguide.db");
    const running = await startTraceguideServer({
      host: args.host,
      port: args.port,
      dbPath,
      publicUrl: args.publicUrl,
      apiToken: args.apiToken,
    });
    console.log(`traceguide v0.1.1 library server listening on ${running.url}`);
    console.log("  Upload a Playwright trace.zip via POST /api/guides/upload?redact=1");
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await running.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    return;
  }

  const zipBuf = args.mode === "demo" ? buildDemoPlaywrightTraceZip() : readFileSync(resolve(args.tracePath!));
  const guide = parsePlaywrightTraceZip(zipBuf, {
    title: args.title ?? (args.mode === "demo" ? "Create Production API Key (Demo)" : undefined),
    sourceFile: args.mode === "demo" ? "demo-trace.zip" : args.tracePath,
    redactPii: args.redactPii,
  });

  const outAbs = resolve(args.outPath);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, renderGuideHtml(guide), "utf8");

  if (args.markdownPath) {
    const mdAbs = resolve(args.markdownPath);
    mkdirSync(dirname(mdAbs), { recursive: true });
    writeFileSync(mdAbs, renderGuideMarkdown(guide), "utf8");
  }

  console.log(
    `traceguide compiled ${guide.steps.length} step(s) (${guide.redactedTotal} PII redacted) -> ${outAbs}`
  );
  if (args.markdownPath) {
    console.log(`  markdown -> ${resolve(args.markdownPath)}`);
  }
}

function isDirectEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)).toLowerCase() ===
      realpathSync(resolve(process.argv[1])).toLowerCase()
    );
  } catch {
    return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
  }
}

if (isDirectEntry()) {
  main().catch((err) => {
    console.error(`[traceguide] Error: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
