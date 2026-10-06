import assert from "node:assert/strict";
import test from "node:test";

import { buildSprintPlan, buildTaskPlan, mapStatuses, resolveTaskTypes } from "../paca/plan.mjs";

function board() {
	return {
		version: "1.0.0",
		program: {
			id: "vg",
			name: "Programa",
			indicator: "E2-02-A2",
			timeUnit: "fortnight",
			periods: [
				{ index: 1, label: "14-31 ago 2026", startDate: "2026-08-14", endDate: "2026-08-31" },
				{ index: 2, label: "1-15 sep 2026", startDate: "2026-09-01", endDate: "2026-09-15" },
				{ index: 3, label: "16-30 sep 2026", startDate: "2026-09-16", endDate: "2026-09-30" },
			],
		},
		people: [{ id: "ana", name: "Ana Ruiz", role: "Backend" }],
		epics: [{ id: "f1", key: "F1", title: "Base", objective: "Ingesta", owner: "ana", startPeriod: 1, duration: 2 }],
		items: [
			{ id: "t1", key: "F1-a", epic: "f1", title: "Sync", type: "task", status: "done", owner: "ana", startPeriod: 1, duration: 1 },
			{ id: "t2", key: "F1-b", epic: "f1", title: "OCR", type: "task", status: "review", owner: "ana" },
		],
		deliverables: [],
		milestones: [],
	};
}

const PACA_STATUSES = [
	{ id: "s-backlog", name: "Backlog", category: "backlog" },
	{ id: "s-todo", name: "To Do", category: "todo" },
	{ id: "s-doing", name: "In Progress", category: "inprogress" },
	{ id: "s-done", name: "Done", category: "done" },
];

const PACA_TYPES = [
	{ id: "ty-epic", name: "Epic", is_system: true },
	{ id: "ty-task", name: "Task", is_system: false },
	{ id: "ty-doc", name: "Documentation", is_system: false },
];

test("mapStatuses resolves every board status onto a project status", () => {
	const { map, unresolved } = mapStatuses(PACA_STATUSES);
	assert.deepEqual(unresolved, []);
	assert.equal(map.todo.id, "s-todo");
	assert.equal(map.in_progress.id, "s-doing");
	assert.equal(map.done.id, "s-done");
});

test("mapStatuses folds review and blocked onto in-progress and tags them", () => {
	const { map } = mapStatuses(PACA_STATUSES);
	// Paca has no review or blocked category, so the distinction survives as a tag.
	assert.equal(map.review.id, "s-doing");
	assert.equal(map.review.tag, "review");
	assert.equal(map.blocked.id, "s-doing");
	assert.equal(map.blocked.tag, "blocked");
});

test("mapStatuses prefers an exact status name over the category fallback", () => {
	const withReview = [...PACA_STATUSES, { id: "s-review", name: "En revisión", category: "inprogress" }];
	const { map } = mapStatuses(withReview);
	assert.equal(map.review.id, "s-review");
	assert.equal(map.review.tag, undefined);
});

test("mapStatuses reports statuses it cannot resolve instead of guessing", () => {
	const { unresolved } = mapStatuses([{ id: "s-only", name: "Backlog", category: "backlog" }]);
	assert.ok(unresolved.includes("todo"));
	assert.ok(unresolved.includes("done"));
});

test("resolveTaskTypes finds the system Epic type and a default for work items", () => {
	const types = resolveTaskTypes(PACA_TYPES);
	assert.equal(types.epic, "ty-epic");
	assert.equal(types.task, "ty-task");
	assert.equal(types.doc, "ty-doc");
});

test("resolveTaskTypes falls back to the task type when a kind has no match", () => {
	const types = resolveTaskTypes([
		{ id: "ty-epic", name: "Epic", is_system: true },
		{ id: "ty-task", name: "Task", is_system: false },
	]);
	assert.equal(types.doc, "ty-task");
	assert.equal(types.spike, "ty-task");
});

test("resolveTaskTypes refuses to continue without an Epic type", () => {
	assert.throws(() => resolveTaskTypes([{ id: "ty-task", name: "Task", is_system: false }]), /Epic/);
});

test("buildSprintPlan creates one sprint per period with dates from the board", () => {
	const plan = buildSprintPlan(board(), "2026-09-10");
	assert.equal(plan.length, 3);
	assert.deepEqual(plan[0], {
		period: 1,
		payload: {
			name: "14-31 ago 2026",
			start_date: "2026-08-14",
			end_date: "2026-08-31",
			goal: "Quincena 1 de 3",
			status: "completed",
		},
	});
});

test("buildSprintPlan marks the period containing the reference date active", () => {
	const plan = buildSprintPlan(board(), "2026-09-10");
	assert.equal(plan[1].payload.status, "active");
	assert.equal(plan[2].payload.status, "planned");
});

test("buildSprintPlan leaves every sprint planned before the window opens", () => {
	const plan = buildSprintPlan(board(), "2026-01-01");
	assert.deepEqual(
		plan.map((entry) => entry.payload.status),
		["planned", "planned", "planned"],
	);
});

function taskContext() {
	return {
		types: resolveTaskTypes(PACA_TYPES),
		statuses: mapStatuses(PACA_STATUSES).map,
		sprintIdByPeriod: new Map([
			[1, "sp-1"],
			[2, "sp-2"],
			[3, "sp-3"],
		]),
		userIdByPerson: new Map([["ana", "user-ana"]]),
	};
}

test("buildTaskPlan emits every epic before any of its children", () => {
	const plan = buildTaskPlan(board(), taskContext());
	assert.equal(plan[0].kind, "epic");
	assert.equal(plan[0].ref, "f1");
	assert.ok(plan.slice(1).every((entry) => entry.kind === "item"));
});

test("buildTaskPlan builds an epic payload with its own type and schedule", () => {
	const [epic] = buildTaskPlan(board(), taskContext());
	assert.equal(epic.payload.title, "F1 · Base");
	assert.equal(epic.payload.task_type_id, "ty-epic");
	assert.equal(epic.payload.start_date, "2026-08-14");
	assert.equal(epic.payload.due_date, "2026-09-15");
	assert.equal(epic.payload.sprint_id, "sp-1");
});

test("buildTaskPlan parents each item under its epic and assigns its owner", () => {
	const plan = buildTaskPlan(board(), taskContext());
	const item = plan.find((entry) => entry.ref === "t1");
	assert.equal(item.parentRef, "f1");
	assert.equal(item.payload.status_id, "s-done");
	assert.deepEqual(item.payload.assignee_ids, ["user-ana"]);
	assert.equal(item.payload.sprint_id, "sp-1");
	assert.equal(item.payload.start_date, "2026-08-14");
	assert.equal(item.payload.due_date, "2026-08-31");
});

test("buildTaskPlan carries the board key and folded status as tags", () => {
	const plan = buildTaskPlan(board(), taskContext());
	const review = plan.find((entry) => entry.ref === "t2");
	assert.ok(review.payload.tags.includes("F1-b"));
	assert.ok(review.payload.tags.includes("review"));
});

test("buildTaskPlan omits the schedule for an item with no declared period", () => {
	const plan = buildTaskPlan(board(), taskContext());
	const unscheduled = plan.find((entry) => entry.ref === "t2");
	assert.equal(unscheduled.payload.start_date, undefined);
	assert.equal(unscheduled.payload.sprint_id, undefined);
});

test("buildTaskPlan omits assignees it cannot resolve rather than sending a bad id", () => {
	const context = taskContext();
	context.userIdByPerson = new Map();
	const plan = buildTaskPlan(board(), context);
	assert.equal(plan[1].payload.assignee_ids, undefined);
});
