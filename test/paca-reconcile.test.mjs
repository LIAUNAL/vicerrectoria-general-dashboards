import assert from "node:assert/strict";
import test from "node:test";

import { reconcileBoard, statusFromRemote } from "../paca/plan.mjs";

function board() {
	return {
		version: "1.0.0",
		program: {
			id: "vg",
			name: "Programa",
			indicator: "E2-02-A2",
			timeUnit: "fortnight",
			periods: [{ index: 1, label: "q1", startDate: "2026-08-14", endDate: "2026-08-31" }],
		},
		people: [],
		epics: [{ id: "f1", key: "F1", title: "Base", objective: "Ingesta", startPeriod: 1, duration: 1 }],
		items: [
			{ id: "t1", key: "F1-a", epic: "f1", title: "Sync", type: "task", status: "todo" },
			{ id: "t2", key: "F1-b", epic: "f1", title: "OCR", type: "task", status: "done" },
		],
		deliverables: [],
		milestones: [],
	};
}

test("statusFromRemote reads the status category back into a board status", () => {
	assert.equal(statusFromRemote("done", []), "done");
	assert.equal(statusFromRemote("inprogress", []), "in_progress");
	assert.equal(statusFromRemote("todo", []), "todo");
	assert.equal(statusFromRemote("backlog", []), "todo");
	assert.equal(statusFromRemote("refinement", []), "todo");
});

test("statusFromRemote recovers review and blocked from the tag the seed wrote", () => {
	assert.equal(statusFromRemote("inprogress", ["F1-a", "review"]), "review");
	assert.equal(statusFromRemote("inprogress", ["F1-a", "blocked"]), "blocked");
});

test("statusFromRemote ignores a stale tag when the category already disagrees", () => {
	// A task dragged to Done still carries its old review tag; Done wins.
	assert.equal(statusFromRemote("done", ["review"]), "done");
});

test("reconcileBoard applies remote statuses and reports each change", () => {
	const { board: next, changes } = reconcileBoard(board(), [
		{ tags: ["F1-a"], category: "inprogress" },
		{ tags: ["F1-b"], category: "done" },
	]);
	assert.deepEqual(changes, [{ key: "F1-a", from: "todo", to: "in_progress" }]);
	assert.equal(next.items[0].status, "in_progress");
	assert.equal(next.items[1].status, "done");
});

test("reconcileBoard does not mutate the board it was given", () => {
	const original = board();
	reconcileBoard(original, [{ tags: ["F1-a"], category: "done" }]);
	assert.equal(original.items[0].status, "todo");
});

test("reconcileBoard reports board items absent from Paca instead of clearing them", () => {
	const { board: next, missing } = reconcileBoard(board(), [{ tags: ["F1-a"], category: "done" }]);
	assert.deepEqual(missing, ["F1-b"]);
	assert.equal(next.items[1].status, "done");
});

test("reconcileBoard ignores remote tasks that carry no board key", () => {
	const { changes, unknown } = reconcileBoard(board(), [{ tags: ["ad-hoc"], category: "done" }]);
	assert.deepEqual(changes, []);
	assert.deepEqual(unknown, ["ad-hoc"]);
});

test("reconcileBoard stamps the update date when something changed", () => {
	const { board: next } = reconcileBoard(board(), [{ tags: ["F1-a"], category: "done" }], "2026-10-05");
	assert.equal(next.updatedAt, "2026-10-05");
});
