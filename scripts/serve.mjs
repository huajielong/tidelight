import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChallengeApi } from './challenge-api.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realProjectRoot = await realpath(projectRoot);
const handleApi = createChallengeApi();

const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parsePort(argv, environmentPort) {
  let cliPort;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--port") {
      if (index + 1 >= argv.length) {
        throw new Error("Missing value for --port");
      }
      cliPort = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--port=")) {
      cliPort = argument.slice("--port=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const value = cliPort ?? environmentPort ?? "4173";
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port: ${value}`);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Port must be an integer between 1 and 65535: ${value}`);
  }

  return port;
}

function isWithinProject(candidate) {
  const relative = path.relative(realProjectRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolvePublicFile(requestPath) {
  const normalizedSeparators = requestPath.replaceAll("\\", "/");
  const segments = normalizedSeparators.split("/");
  const publicRoots = new Set(['index.html', 'styles.css', 'src', 'assets']);
  // Only ship game assets. Secrets, logs, source server and Git metadata stay private.
  if (segments.some(segment => segment.startsWith('.')) || (segments[1] && !publicRoots.has(segments[1]))) return null;
  if (segments.includes("..") || normalizedSeparators.includes("\0")) {
    const error = new Error("Unsafe path");
    error.code = "UNSAFE_PATH";
    throw error;
  }

  const candidate = path.resolve(projectRoot, `.${normalizedSeparators}`);
  if (!isWithinProject(candidate)) {
    const error = new Error("Unsafe path");
    error.code = "UNSAFE_PATH";
    throw error;
  }

  try {
    let candidateStats = await stat(candidate);
    let file = candidate;

    if (candidateStats.isDirectory()) {
      file = path.join(candidate, "index.html");
      candidateStats = await stat(file);
    }

    if (!candidateStats.isFile()) {
      return null;
    }

    const canonicalFile = await realpath(file);
    if (!isWithinProject(canonicalFile)) {
      const error = new Error("Unsafe path");
      error.code = "UNSAFE_PATH";
      throw error;
    }

    return { file: canonicalFile, size: candidateStats.size };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

function sendText(response, statusCode, message) {
  const body = `${message}\n`;
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendFile(request, response, resource) {
  const contentType = mimeTypes.get(path.extname(resource.file).toLowerCase())
    ?? "application/octet-stream";

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": resource.size,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(resource.file);
  stream.on("error", (error) => {
    console.error(error);
    response.destroy(error);
  });
  stream.pipe(response);
}

const port = parsePort(process.argv.slice(2), process.env.PORT);

const server = createServer(async (request, response) => {
  let requestPath;
  try { requestPath = new URL(request.url ?? '/', 'http://localhost').pathname; }
  catch { sendText(response, 400, 'Bad Request'); return; }
  if (await handleApi(request, response, requestPath)) return;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    let pathname;

    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      sendText(response, 400, "Bad Request");
      return;
    }

    let resource = await resolvePublicFile(pathname);
    if (!resource) {
      sendText(response, 404, "Not Found");
      return;
    }

    sendFile(request, response, resource);
  } catch (error) {
    if (error?.code === "UNSAFE_PATH") {
      sendText(response, 403, "Forbidden");
      return;
    }

    console.error(error);
    sendText(response, 500, "Internal Server Error");
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;

server.on("error", (error) => {
  console.error(`Server failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${projectRoot} at http://localhost:${port}`);
});
