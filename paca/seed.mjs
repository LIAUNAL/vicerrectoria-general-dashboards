#!/usr/bin/env node
/**
 * Seed `data/board.json` into a self-hosted Paca project.
 *
 * Dry run by default. Nothing is written to Paca without `--apply`, because a
 * mis-targeted seed would scatter tasks across somebody else's project and
 * there is no bulk undo.
 *
 * Reuse over recreation: sprints are matched by name and tasks by their board
 * key, which the seed writes as a tag. Running it twice updates rather than
 * duplicates.
 *
 * Usage:
 *   PACA_BASE_URL=http://localhost:3000/api/v1 \
 *   PACA_API_KEY=paca_... \
 *   node paca/seed.mjs --project "Vicerrectoría General — Dashboards" [--apply]
 */
import { readFile } from "node:fs/promises";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { validateBoard } from "../lib/board.mjs";
import { PacaError, asList, clientFromEnv } from "./client.mjs";
import { buildSprintPlan, buildTaskPlan, mapStatuses, resolveTaskTypes } from "./plan.mjs";

function parseArgs(args) {
	const options = { apply: false, project: env.PACA_PROJECT ?? "Vicerrectoría General — Dashboards" };
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--apply") options.apply = true;
		else if (args[index] === "--project") options.project = args[index + 1];
	}
	return options;
}

const log = (line = "") => stdout.write(`${line}\n`);

/** Find a project by exact name, or create it when applying. */
async function resolveProject(client, name, apply) {
	const projects = asList(await client.listProjects(), "projects", "items");
	const existing = projects.find((project) => project.name === name);
	if (existing !== undefined) {
		log(`project      reusing "${name}" (${existing.id})`);
		return existing;
	}
	if (!apply) {
		log(`project      would create "${name}"`);
		return null;
	}
	const created = await client.createProject({
		name,
		description: "Seguimiento del prototipo de tablero institucional RAG (indicador E2-02-A2).",
		task_id_prefix: "VG",
		is_public: false,
	});
	log(`project      created "${name}" (${created.id})`);
	return created;
}

async function seedSprints(client, project, board, apply) {
	const plan = buildSprintPlan(board);
	const existing = project === null ? [] : asList(await client.listSprints(project.id), "sprints", "items");
	const idByPeriod = new Map();

	for (const entry of plan) {
		const match = existing.find((sprint) => sprint.name === entry.payload.name);
		if (match !== undefined) {
			idByPeriod.set(entry.period, match.id);
			log(`sprint       reusing  ${entry.payload.name} [${entry.payload.status}]`);
			continue;
		}
		if (!apply) {
			log(`sprint       would create ${entry.payload.name} [${entry.payload.status}]`);
			continue;
		}
		const created = await client.createSprint(project.id, entry.payload);
		idByPeriod.set(entry.period, created.id);
		log(`sprint       created  ${entry.payload.name} [${entry.payload.status}]`);
	}
	return idByPeriod;
}

/**
 * Match board people to project members by display name.
 *
 * Unmatched people are reported and left unassigned: inventing a user id would
 * fail the request, and assigning the wrong person is worse than assigning none.
 */
function mapPeople(board, members) {
	const byName = new Map(
		members.map((member) => [
			String(member.user?.name ?? member.name ?? member.user?.username ?? "").trim().toLowerCase(),
			member.user?.id ?? member.user_id,
		]),
	);
	const userIdByPerson = new Map();
	const unmatched = [];
	for (const person of board.people) {
		const id = byName.get(person.name.trim().toLowerCase());
		if (id === undefined) unmatched.push(person.name);
		else userIdByPerson.set(person.id, id);
	}
	return { userIdByPerson, unmatched };
}

async function seedTasks(client, project, board, context, apply) {
	const plan = buildTaskPlan(board, context);
	const existing = project === null ? [] : asList(await client.listTasks(project.id), "tasks", "items");

	/** Board key -> existing task, using the tag the seed itself writes. */
	const byKey = new Map();
    for (const task of existing) {
		for (const tag of task.tags ?? []) {
			const name = typeof tag === "string" ? tag : tag.name;
			if (name !== undefined && !byKey.has(name)) byKey.set(name, task);
		}
	}

	const idByRef = new Map();
	let created = 0;
	let updated = 0;

	for (const entry of plan) {
		const key = entry.payload.tags[0];
		const payload = { ...entry.payload };
		if (entry.parentRef !== undefined) {
			const parentId = idByRef.get(entry.parentRef);
			if (parentId !== undefined) payload.parent_task_id = parentId;
		}

		const match = byKey.get(key);
		if (match !== undefined) {
			idByRef.set(entry.ref, match.id);
			if (apply) {
				await client.updateTask(project.id, match.id, { status_id: payload.status_id });
				updated += 1;
			}
			log(`task         ${apply ? "updated " : "would update"} ${key.padEnd(7)} ${payload.title}`);
			continue;
		}

		if (!apply) {
			log(`task         would create ${key.padEnd(7)} ${payload.title}`);
			continue;
		}
		const task = await client.createTask(project.id, payload);
		idByRef.set(entry.ref, task.id);
		created += 1;
		log(`task         created  ${key.padEnd(7)} ${payload.title}`);
	}

	return { created, updated, planned: plan.length };
}

async function main() {
	const options = parseArgs(argv.slice(2));
	const board = JSON.parse(await readFile(fileURLToPath(new URL("../data/board.json", import.meta.url)), "utf8"));

	const { valid, errors } = validateBoard(board);
	if (!valid) {
		log(`FAIL  data/board.json has ${errors.length} problem(s); run npm run check`);
		return 1;
	}

	log(options.apply ? "mode         APPLY — writing to Paca" : "mode         DRY RUN — pass --apply to write");
	const client = await clientFromEnv(env);
	log(`endpoint     ${client.baseUrl}`);

	const project = await resolveProject(client, options.project, options.apply);
	if (project === null && options.apply) throw new PacaError("project could not be resolved");

	let types = { epic: "<epic>", story: "<task>", task: "<task>", spike: "<task>", doc: "<task>" };
	let statuses = Object.fromEntries(
		["todo", "in_progress", "review", "blocked", "done"].map((status) => [status, { id: `<${status}>` }]),
	);
	let userIdByPerson = new Map();

	if (project !== null) {
		types = resolveTaskTypes(asList(await client.listTaskTypes(project.id), "task_types", "items"));
		const mapped = mapStatuses(asList(await client.listTaskStatuses(project.id), "task_statuses", "items"));
		if (mapped.unresolved.length > 0) {
			throw new PacaError(
				`the project has no status for: ${mapped.unresolved.join(", ")}. ` +
					"Add them under Settings -> Task statuses, then run again.",
			);
		}
		statuses = mapped.map;

		const people = mapPeople(board, asList(await client.listMembers(project.id), "members", "items"));
		userIdByPerson = people.userIdByPerson;
		if (people.unmatched.length > 0) {
			log(`members      unmatched, left unassigned: ${people.unmatched.join(", ")}`);
		}
	}

	const sprintIdByPeriod = await seedSprints(client, project, board, options.apply);
	const result = await seedTasks(
		client,
		project,
		board,
		{ types, statuses, sprintIdByPeriod, userIdByPerson },
		options.apply,
	);

	log();
	log(`summary      ${result.planned} tasks planned, ${result.created} created, ${result.updated} updated`);
	if (!options.apply) log("summary      nothing was written; re-run with --apply");
	return 0;
}

try {
	exit(await main());
} catch (error) {
	log(`FAIL  ${error instanceof PacaError ? error.message : (error.stack ?? error.message)}`);
	exit(1);
}
