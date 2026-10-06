#!/usr/bin/env node
/**
 * Assemble the publishable site into `dist/`.
 *
 * The site, the CI check and the Paca scripts share `lib/board.mjs` and
 * `data/board.json` verbatim; copying them at build time keeps one source of
 * truth in the repository instead of a second copy under `site/` that would
 * drift.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { validateBoard } from "../lib/board.mjs";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const resolve = (relative) => fileURLToPath(new URL(relative, root));

const COPIES = [
	["site/index.html", "index.html"],
	["site/styles.css", "styles.css"],
	["site/app.mjs", "app.mjs"],
	["lib/board.mjs", "lib/board.mjs"],
	["data/board.json", "data/board.json"],
	["schema/board.schema.json", "schema/board.schema.json"],
];

async function main() {
	const out = argv[2] ?? resolve("dist");

	const board = JSON.parse(await readFile(resolve("data/board.json"), "utf8"));
	const { valid, errors } = validateBoard(board);
	if (!valid) {
		stdout.write(`FAIL  data/board.json has ${errors.length} problem(s); run npm run check\n`);
		return 1;
	}

	await rm(out, { recursive: true, force: true });
	await mkdir(`${out}/lib`, { recursive: true });
	await mkdir(`${out}/data`, { recursive: true });
	await mkdir(`${out}/schema`, { recursive: true });

	for (const [from, to] of COPIES) {
		await cp(resolve(from), `${out}/${to}`);
	}

	// Pages would otherwise run the output through Jekyll, which ignores paths
	// beginning with an underscore and rewrites nothing else usefully here.
	await writeFile(`${out}/.nojekyll`, "");

	stdout.write(`OK    built ${COPIES.length + 1} files into ${out}\n`);
	return 0;
}

exit(await main());
