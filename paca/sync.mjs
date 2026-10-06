#!/usr/bin/env node
/**
 * Pull live task statuses from Paca back into `data/board.json`.
 *
 * This is the return leg of the seed: Paca is where the team moves cards, and
 * the published dashboard should follow it rather than drift.
 *
 * Dry run by default; `--apply` rewrites the data file. Commit the result to
 * publish it, so every change to the public board stays reviewable.
 *
 * Usage:
 *   PACA_BASE_URL=... PACA_API_KEY=... \
 *   node paca/sync.mjs --project "Vicerrectoría General — Dashboards" [--apply]
 */
import { readFile, writeFile } from "node:fs/promises";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { validateBoard } from "../lib/board.mjs";
import { PacaError, asList, clientFromEnv } from "./client.mjs";
import { reconcileBoard } from "./plan.mjs";

const BOARD_PATH = fileURLToPath(new URL("../data/board.json", import.meta.url));
const log = (line = "") => stdout.write(`${line}\n`);

function parseArgs(args) {
	const options = { apply: false, project: env.PACA_PROJECT ?? "Vicerrectoría General — Dashboards" };
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--apply") options.apply = true;
		else if (args[index] === "--project") options.project = args[index + 1];
	}
	return options;
}

async function main() {
	const options = parseArgs(argv.slice(2));
	const board = JSON.parse(await readFile(BOARD_PATH, "utf8"));

	log(options.apply ? "mode         APPLY — data/board.json will be rewritten" : "mode         DRY RUN");
	const client = await clientFromEnv(env);
	log(`endpoint     ${client.baseUrl}`);

	const projects = asList(await client.listProjects(), "projects", "items");
	const project = projects.find((candidate) => candidate.name === options.project);
	if (project === undefined) {
		throw new PacaError(`no project named "${options.project}"; seed it first with paca/seed.mjs --apply`);
	}
	log(`project      ${project.name} (${project.id})`);

	// Statuses are per-project rows; their category is what carries meaning.
	const statuses = asList(await client.listTaskStatuses(project.id), "task_statuses", "items");
	const categoryById = new Map(statuses.map((status) => [status.id, status.category]));

	const tasks = asList(await client.listTasks(project.id), "tasks", "items");
	const remote = tasks.map((task) => ({
		tags: task.tags ?? [],
		category: categoryById.get(task.status_id ?? task.status?.id) ?? "todo",
	}));
	log(`tasks        ${remote.length} read from Paca`);

	const result = reconcileBoard(board, remote);

	if (result.unknown.length > 0) {
		const sample = [...new Set(result.unknown)].slice(0, 8).join(", ");
		log(`unmatched    ${result.unknown.length} remote tag(s) with no board item: ${sample}`);
	}
	if (result.missing.length > 0) {
		log(`missing      ${result.missing.length} board item(s) absent from Paca, left untouched: ${result.missing.join(", ")}`);
	}

	if (result.changes.length === 0) {
		log("summary      board already matches Paca; nothing to write");
		return 0;
	}

	for (const change of result.changes) {
		log(`change       ${change.key.padEnd(7)} ${change.from} -> ${change.to}`);
	}

	const { valid, errors } = validateBoard(result.board);
	if (!valid) {
		log(`FAIL  the reconciled board breaks its contract: ${errors[0]}`);
		return 1;
	}

	if (!options.apply) {
		log(`summary      ${result.changes.length} change(s); re-run with --apply to write`);
		return 0;
	}

	await writeFile(BOARD_PATH, `${JSON.stringify(result.board, null, 2)}\n`, "utf8");
	log(`summary      ${result.changes.length} change(s) written to data/board.json`);
	return 0;
}

try {
	exit(await main());
} catch (error) {
	log(`FAIL  ${error instanceof PacaError ? error.message : (error.stack ?? error.message)}`);
	exit(1);
}
