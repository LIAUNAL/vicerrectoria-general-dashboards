import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeEpicProgress, periodRange, scheduleBounds, validateBoard } from "../lib/board.mjs";

/**
 * Regression tests over the real published data, so a hand edit to
 * `data/board.json` cannot reach Pages in a broken state.
 */
const board = JSON.parse(await readFile(fileURLToPath(new URL("../data/board.json", import.meta.url)), "utf8"));

test("the published board satisfies the contract", () => {
	const { valid, errors } = validateBoard(board);
	assert.deepEqual(errors, []);
	assert.equal(valid, true);
});

test("every epic carries at least one work item", () => {
	for (const epic of board.epics) {
		assert.ok(computeEpicProgress(board, epic.id).total > 0, `epic ${epic.key} has no items`);
	}
});

test("declared periods are chronological and leave no gap", () => {
	const periods = board.program.periods;
	for (let index = 1; index < periods.length; index += 1) {
		assert.ok(
			periods[index].startDate > periods[index - 1].endDate,
			`period ${periods[index].index} starts before period ${periods[index - 1].index} ends`,
		);
	}
	assert.equal(scheduleBounds(board).totalPeriods, periods.length);
});

test("every scheduled item sits inside its own epic's window", () => {
	const epicsById = new Map(board.epics.map((epic) => [epic.id, epic]));
	for (const item of board.items) {
		if (item.startPeriod === undefined || item.duration === undefined) continue;
		const epic = epicsById.get(item.epic);
		const itemEnd = item.startPeriod + item.duration - 1;
		const epicEnd = epic.startPeriod + epic.duration - 1;
		assert.ok(
			item.startPeriod >= epic.startPeriod && itemEnd <= epicEnd,
			`${item.key} (${item.startPeriod}-${itemEnd}) escapes ${epic.key} (${epic.startPeriod}-${epicEnd})`,
		);
	}
});

test("every period reference the dashboard renders can be resolved", () => {
	for (const deliverable of board.deliverables) {
		assert.ok(periodRange(board.program, deliverable.duePeriod).label.length > 0);
	}
	for (const milestone of board.milestones) {
		assert.ok(periodRange(board.program, milestone.period).label.length > 0);
	}
});

test("no monetary figure leaked into the public board", () => {
	// The source report is private and carries budget data; this board must not.
	const serialized = JSON.stringify(board);
	for (const pattern of [/\$\s?\d/, /\bCOP\b/, /\bUSD\b/, /\bmillones\b/i, /\bpesos\b/i]) {
		assert.ok(!pattern.test(serialized), `board contains a monetary figure matching ${pattern}`);
	}
});
