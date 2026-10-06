/**
 * Translate the board into Paca API payloads.
 *
 * Pure functions only: no network, no process state. The seed script is a thin
 * I/O shell around this module, so the translation is verifiable without a
 * running Paca instance.
 *
 * Two facts about Paca shape this mapping:
 *
 * 1. There is no epics endpoint. An epic is a task whose task type is the
 *    system type named "Epic"; children hang off it through `parent_task_id`.
 * 2. Statuses and task types are per-project rows, not enums. They must be
 *    read from the project and matched, never invented.
 */

import { periodRange } from "../lib/board.mjs";

/**
 * How each board status reaches a Paca status.
 *
 * `names` is tried first so a project that models review explicitly keeps the
 * distinction. `category` is the fallback, and `tag` records what the fallback
 * flattened so the information is not lost.
 */
const STATUS_PLAN = {
	todo: { category: "todo", names: ["por hacer", "to do", "todo", "pendiente"] },
	in_progress: { category: "inprogress", names: ["en curso", "in progress", "doing", "en progreso"] },
	review: { category: "inprogress", names: ["en revision", "review", "in review", "revision"], tag: "review" },
	blocked: { category: "inprogress", names: ["bloqueado", "blocked"], tag: "blocked" },
	done: { category: "done", names: ["hecho", "done", "completado", "terminado"] },
};

/** Task-type name aliases per board item kind. Epic is required; the rest degrade. */
const TYPE_NAMES = {
	epic: ["epic", "epica", "épica"],
	story: ["story", "user story", "historia", "historia de usuario"],
	task: ["task", "tarea"],
	spike: ["spike", "research", "investigacion", "exploracion"],
	doc: ["documentation", "doc", "documento", "documentacion"],
};

/** Lowercase and strip accents so "En revisión" matches "en revision". */
function normalize(value) {
	return String(value ?? "")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.toLowerCase();
}

/**
 * Map each board status onto a status row of the target project.
 *
 * @returns {{ map: Record<string, {id: string, name: string, tag?: string}>, unresolved: string[] }}
 */
export function mapStatuses(projectStatuses) {
	const map = {};
	const unresolved = [];

	for (const [boardStatus, plan] of Object.entries(STATUS_PLAN)) {
		const byName = projectStatuses.find((status) => plan.names.includes(normalize(status.name)));
		if (byName !== undefined) {
			map[boardStatus] = { id: byName.id, name: byName.name };
			continue;
		}
		const byCategory = projectStatuses.find((status) => status.category === plan.category);
		if (byCategory !== undefined) {
			map[boardStatus] = { id: byCategory.id, name: byCategory.name, ...(plan.tag ? { tag: plan.tag } : {}) };
			continue;
		}
		unresolved.push(boardStatus);
	}

	return { map, unresolved };
}

/**
 * Resolve the task type id for each board item kind.
 *
 * @throws {Error} when the project exposes no system Epic type, since the whole
 *   parent/child structure depends on it and guessing would flatten the board.
 */
export function resolveTaskTypes(projectTypes) {
	const find = (names) => projectTypes.find((type) => names.includes(normalize(type.name)));

	const epic = projectTypes.find((type) => type.is_system === true && normalize(type.name) === "epic") ?? find(TYPE_NAMES.epic);
	if (epic === undefined) {
		throw new Error(
			'the project exposes no "Epic" task type; Paca seeds it as a system type and the API cannot create one',
		);
	}

	const task = find(TYPE_NAMES.task) ?? projectTypes.find((type) => type.is_system !== true);
	if (task === undefined) {
		throw new Error("the project exposes no non-system task type to hold work items");
	}

	return {
		epic: epic.id,
		story: (find(TYPE_NAMES.story) ?? task).id,
		task: task.id,
		spike: (find(TYPE_NAMES.spike) ?? task).id,
		doc: (find(TYPE_NAMES.doc) ?? task).id,
	};
}

/**
 * One sprint per tracked period.
 *
 * Sprint state is derived from `today` rather than from item status: a period
 * that has ended is completed even if work inside it is still open, which is
 * exactly the signal a tracking board should carry.
 */
export function buildSprintPlan(board, today = new Date().toISOString().slice(0, 10)) {
	const { periods, timeUnit } = board.program;
	const unit = timeUnit === "fortnight" ? "Quincena" : "Mes";

	return periods.map((period) => {
		let status = "planned";
		if (period.endDate < today) status = "completed";
		else if (period.startDate <= today) status = "active";

		return {
			period: period.index,
			payload: {
				name: period.label,
				start_date: period.startDate,
				end_date: period.endDate,
				goal: `${unit} ${period.index} de ${periods.length}`,
				status,
			},
		};
	});
}

/** Calendar span covered by a start period and a duration, or undefined when unscheduled. */
function span(program, startPeriod, duration) {
	if (startPeriod === undefined || duration === undefined) return undefined;
	const first = periodRange(program, startPeriod);
	const last = periodRange(program, startPeriod + duration - 1);
	return { start_date: first.startDate, due_date: last.endDate };
}

function scheduleFields(program, entity, sprintIdByPeriod) {
	const dates = span(program, entity.startPeriod, entity.duration);
	if (dates === undefined) return {};
	const sprintId = sprintIdByPeriod.get(entity.startPeriod);
	return { ...dates, ...(sprintId !== undefined ? { sprint_id: sprintId } : {}) };
}

function assigneeFields(owner, userIdByPerson) {
	const userId = owner === undefined ? undefined : userIdByPerson.get(owner);
	return userId === undefined ? {} : { assignee_ids: [userId] };
}

/**
 * Ordered creation plan: every epic first, then its children.
 *
 * `parentRef` is a board id, not a Paca id: the caller substitutes the real
 * identifier once the parent has been created, which keeps this module free of
 * any assumption about identifier format.
 *
 * @param {object} board
 * @param {{types: object, statuses: object, sprintIdByPeriod: Map<number,string>,
 *          userIdByPerson: Map<string,string>}} context
 */
export function buildTaskPlan(board, context) {
	const { program } = board;
	const { types, statuses, sprintIdByPeriod, userIdByPerson } = context;
	const plan = [];

	for (const epic of board.epics) {
		plan.push({
			kind: "epic",
			ref: epic.id,
			payload: {
				title: `${epic.key} · ${epic.title}`,
				task_type_id: types.epic,
				status_id: statuses.todo.id,
				tags: [epic.key],
				...scheduleFields(program, epic, sprintIdByPeriod),
				...assigneeFields(epic.owner, userIdByPerson),
			},
		});
	}

	for (const epic of board.epics) {
		for (const item of board.items.filter((candidate) => candidate.epic === epic.id)) {
			const status = statuses[item.status];
			const tags = [item.key, ...(item.tags ?? [])];
			if (status.tag !== undefined) tags.push(status.tag);

			plan.push({
				kind: "item",
				ref: item.id,
				parentRef: epic.id,
				payload: {
					title: item.title,
					task_type_id: types[item.type] ?? types.task,
					status_id: status.id,
					tags,
					...(item.importance !== undefined ? { importance: item.importance } : {}),
					...(item.storyPoints !== undefined ? { story_points: item.storyPoints } : {}),
					...scheduleFields(program, item, sprintIdByPeriod),
					...assigneeFields(item.owner, userIdByPerson),
				},
			});
		}
	}

	return plan;
}

/** Status categories that all mean "not started" on this board. */
const NOT_STARTED = new Set(["backlog", "refinement", "ready", "todo"]);

/**
 * Read a Paca status category back into a board status.
 *
 * The category is authoritative. Tags only disambiguate the in-progress
 * category, which is where the seed folded review and blocked; a task moved to
 * Done keeps its old tag, and trusting that tag would silently undo real
 * progress.
 */
export function statusFromRemote(category, tags = []) {
	if (category === "done") return "done";
	if (category === "inprogress") {
		const names = tags.map((tag) => normalize(typeof tag === "string" ? tag : tag?.name));
		if (names.includes("blocked")) return "blocked";
		if (names.includes("review")) return "review";
		return "in_progress";
	}
	if (NOT_STARTED.has(category)) return "todo";
	return "todo";
}

/**
 * Fold remote task statuses back into the board.
 *
 * Returns a new board rather than mutating the argument, and never deletes:
 * an item missing from Paca is reported, not cleared, because the likeliest
 * cause is a filtered or paginated read rather than deleted work.
 *
 * @returns {{board: object, changes: Array<{key: string, from: string, to: string}>,
 *           missing: string[], unknown: string[]}}
 */
export function reconcileBoard(board, remoteTasks, today = new Date().toISOString().slice(0, 10)) {
	const keys = new Set(board.items.map((item) => item.key));
	const statusByKey = new Map();
	const unknown = [];

	for (const task of remoteTasks) {
		const tags = (task.tags ?? []).map((tag) => (typeof tag === "string" ? tag : tag?.name)).filter(Boolean);
		const key = tags.find((tag) => keys.has(tag));
		if (key === undefined) {
			unknown.push(...tags);
			continue;
		}
		statusByKey.set(key, statusFromRemote(task.category, tags));
	}

	const changes = [];
	const items = board.items.map((item) => {
		const next = statusByKey.get(item.key);
		if (next === undefined || next === item.status) return item;
		changes.push({ key: item.key, from: item.status, to: next });
		return { ...item, status: next };
	});

	const missing = board.items.filter((item) => !statusByKey.has(item.key)).map((item) => item.key);
	const nextBoard = { ...board, items };
	if (changes.length > 0) nextBoard.updatedAt = today;

	return { board: nextBoard, changes, missing, unknown };
}
