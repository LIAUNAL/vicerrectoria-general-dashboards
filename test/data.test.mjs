import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	computeContractProgress,
	computeEpicProgress,
	contractsByPerson,
	periodRange,
	scheduleBounds,
	validateBoard,
} from "../lib/board.mjs";

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

test("no personal identifier leaked from the service orders", () => {
	// The payment packages carry cédulas, phone numbers and emails; none belong here.
	// Hex colours are stripped first: they are six-digit runs that identify nobody.
	const serialized = JSON.stringify(board).replace(/#[0-9a-fA-F]{6}\b/g, "#colour");
	const patterns = [
		[/\b\d{6,12}\b/, "an identification-like number"],
		[/[\w.+-]+@[\w-]+\.[\w.]+/, "an email address"],
		[/\b(?:C\.C\.|C\.E\.|c[ée]dula)\b/i, "a cédula reference"],
	];
	for (const [pattern, description] of patterns) {
		const match = serialized.match(pattern);
		assert.equal(match, null, `board contains ${description}: ${match?.[0]}`);
	}
});

test("every contract belongs to a listed person and reports progress", () => {
	for (const contract of board.contracts ?? []) {
		assert.ok(
			board.people.some((person) => person.id === contract.person),
			`${contract.number} has no matching person`,
		);
		const progress = computeContractProgress(contract);
		assert.ok(progress.total > 0, `${contract.number} lists no obligation`);
		assert.ok(progress.percent >= 0 && progress.percent <= 100);
	}
});

test("every contract that names an epic names one that exists", () => {
	const epicIds = new Set(board.epics.map((epic) => epic.id));
	for (const contract of board.contracts ?? []) {
		if (contract.epic === undefined) continue;
		assert.ok(epicIds.has(contract.epic), `${contract.number} points at unknown epic ${contract.epic}`);
	}
});

test("no person holds more than one contract", () => {
	for (const [person, held] of contractsByPerson(board)) {
		assert.equal(held.length, 1, `${person} holds ${held.length} contracts`);
	}
});

test("every contract sits inside the tracked window", () => {
	const bounds = scheduleBounds(board);
	for (const contract of board.contracts ?? []) {
		assert.ok(
			contract.endDate <= bounds.endDate,
			`${contract.number} ends at ${contract.endDate}, past the tracked window ${bounds.endDate}`,
		);
	}
});
