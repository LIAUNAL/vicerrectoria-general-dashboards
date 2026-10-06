#!/usr/bin/env node
/**
 * Serve `dist/` for local review. Development convenience only: GitHub Pages
 * serves the same directory in production, so nothing here ships.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { env, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../dist", import.meta.url));
const PORT = Number(env.PORT ?? 4173);

const CONTENT_TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
	const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
	// Normalize before joining so `..` cannot escape the served directory.
	const relative = normalize(requested === "/" ? "/index.html" : requested).replace(/^(\.\.[/\\])+/, "");
	const path = join(ROOT, relative);

	try {
		const stats = await stat(path);
		if (!stats.isFile()) throw new Error("not a file");
		response.writeHead(200, {
			"content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
			"cache-control": "no-cache",
		});
		createReadStream(path).pipe(response);
	} catch {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("404");
	}
});

server.listen(PORT, () => stdout.write(`serving ${ROOT} on http://localhost:${PORT}\n`));
