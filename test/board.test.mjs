import assert from "node:assert/strict";
import test from "node:test";

import {
	ITEM_STATUSES,
	ITEM_TYPES,
	computeEpicProgress,
	computeProgramProgress,
	periodRange,
	scheduleBounds,
	validateBoard,
} from "../lib/board.mjs";

/**
 * Smallest board that must validate cleanly; tests derive variants from it.
 *
 * Periods are explicit rather than computed because the real schedule runs in
 * fortnights of uneven length (a month's second fortnight is 13 to 16 days).
 */
function baseBoard() {
	return {
		version: "1.0.0",
		program: {
			id: "vg-dashboards",
			name: "Tablero Institucional RAG",
			indicator: "E2-02-A2",
			timeUnit: "fortnight",
			periods: [
				{ index: 1, label: "14-31 ago 2026", startDate: "2026-08-14", endDate: "2026-08-31" },
				{ index: 2, label: "1-15 sep 2026", startDate: "2026-09-01", endDate: "2026-09-15" },
				{ index: 3, label: "16-30 sep 2026", startDate: "2026-09-16", endDate: "2026-09-30" },
			],
		},
		people: [{ id: "ana", name: "Ana Ruiz", role: "Backend" }],
		epics: [
			{ id: "f1", key: "F1", title: "Base probatoria", objective: "Ingesta", owner: "ana", startPeriod: 1, duration: 2 },
			{ id: "f2", key: "F2", title: "Tablero", objective: "Conciliación", owner: "ana", startPeriod: 2, duration: 2 },
		],
		items: [
			{ id: "t1", key: "F1-a", epic: "f1", title: "Sincronización", type: "task", status: "done", owner: "ana" },
			{ id: "t2", key: "F1-b", epic: "f1", title: "OCR", type: "task", status: "in_progress", owner: "ana" },
			{ id: "t3", key: "F2-a", epic: "f2", title: "Reglas", type: "task", status: "todo", owner: "ana" },
		],
		deliverables: [{ id: "d1", title: "Base relacional", epic: "f1", duePeriod: 2, status: "done" }],
		milestones: [{ id: "m1", title: "Presentación a la dirección", period: 3 }],
	};
}

test("validateBoard accepts a well-formed board", () => {
	const result = validateBoard(baseBoard());
	assert.deepEqual(result.errors, []);
	assert.equal(result.valid, true);
});

test("validateBoard reports a missing required program field", () => {
	const board = baseBoard();
	delete board.program.indicator;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("program.indicator")));
});

test("validateBoard rejects an unknown time unit", () => {
	const board = baseBoard();
	board.program.timeUnit = "quarter";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("timeUnit")));
});

test("validateBoard rejects periods whose indexes are not contiguous from one", () => {
	const board = baseBoard();
	board.program.periods[2].index = 9;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("index")));
});

test("validateBoard rejects a period ending before it starts", () => {
	const board = baseBoard();
	board.program.periods[0].endDate = "2026-08-01";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("endDate")));
});

test("validateBoard rejects a malformed period date", () => {
	const board = baseBoard();
	board.program.periods[1].startDate = "01/09/2026";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("startDate")));
});

test("validateBoard rejects an unknown item status", () => {
	const board = baseBoard();
	board.items[0].status = "almost";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("items[0].status")));
});

test("validateBoard rejects duplicate identifiers inside a collection", () => {
	const board = baseBoard();
	board.items[1].id = board.items[0].id;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("duplicate")));
});

test("validateBoard rejects an item pointing at an unknown epic", () => {
	const board = baseBoard();
	board.items[2].epic = "f9";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("f9")));
});

test("validateBoard rejects an owner who is not in people", () => {
	const board = baseBoard();
	board.items[0].owner = "ghost";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("ghost")));
});

test("validateBoard rejects an epic running past the last period", () => {
	const board = baseBoard();
	board.epics[1].duration = 5;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("past the last period")));
});

test("validateBoard rejects a milestone outside the period range", () => {
	const board = baseBoard();
	board.milestones[0].period = 8;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("milestones[0].period")));
});

test("validateBoard rejects a deliverable due outside the period range", () => {
	const board = baseBoard();
	board.deliverables[0].duePeriod = 0;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("duePeriod")));
});

test("validateBoard accepts an optional roadmap and checks its horizon", () => {
	const board = baseBoard();
	board.roadmap = {
		timeUnit: "month",
		horizonMonths: 24,
		phases: [{ id: "p1", title: "Preparación", startMonth: 1, durationMonths: 2 }],
		milestones: [{ id: "h1", code: "H1", title: "Corpus caracterizado", month: 2 }],
	};
	assert.equal(validateBoard(board).valid, true);

	board.roadmap.milestones[0].month = 30;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("horizonMonths")));
});

test("ITEM_STATUSES and ITEM_TYPES are the closed sets the dashboard relies on", () => {
	assert.deepEqual(ITEM_STATUSES, ["todo", "in_progress", "review", "blocked", "done"]);
	assert.deepEqual(ITEM_TYPES, ["epic", "story", "task", "spike", "doc"]);
});

test("computeEpicProgress counts items and weights done at one", () => {
	const progress = computeEpicProgress(baseBoard(), "f1");
	assert.equal(progress.total, 2);
	assert.equal(progress.done, 1);
	assert.equal(progress.percent, 50);
});

test("computeEpicProgress reports zero percent for an epic with no items", () => {
	const board = baseBoard();
	board.items = [];
	assert.deepEqual(computeEpicProgress(board, "f1"), {
		total: 0,
		done: 0,
		percent: 0,
		byStatus: { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 },
	});
});

test("computeEpicProgress breaks items down by status", () => {
	const progress = computeEpicProgress(baseBoard(), "f1");
	assert.equal(progress.byStatus.done, 1);
	assert.equal(progress.byStatus.in_progress, 1);
	assert.equal(progress.byStatus.todo, 0);
});

test("computeProgramProgress aggregates every item across epics", () => {
	const progress = computeProgramProgress(baseBoard());
	assert.equal(progress.total, 3);
	assert.equal(progress.done, 1);
	assert.equal(progress.percent, 33);
});

test("periodRange returns the calendar span of a one-based period index", () => {
	const { program } = baseBoard();
	assert.deepEqual(periodRange(program, 1), {
		label: "14-31 ago 2026",
		startDate: "2026-08-14",
		endDate: "2026-08-31",
	});
	assert.equal(periodRange(program, 3).endDate, "2026-09-30");
});

test("periodRange rejects an index outside the declared periods", () => {
	const { program } = baseBoard();
	assert.throws(() => periodRange(program, 4), /period/i);
});

test("scheduleBounds spans the first and last declared period", () => {
	const bounds = scheduleBounds(baseBoard());
	assert.equal(bounds.firstPeriod, 1);
	assert.equal(bounds.lastPeriod, 3);
	assert.equal(bounds.startDate, "2026-08-14");
	assert.equal(bounds.endDate, "2026-09-30");
	assert.equal(bounds.totalPeriods, 3);
});
