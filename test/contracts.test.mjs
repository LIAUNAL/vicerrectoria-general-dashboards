import assert from "node:assert/strict";
import test from "node:test";

import { computeContractProgress, contractsByPerson, validateBoard } from "../lib/board.mjs";

/**
 * Contracts are a second lens over the same programme: what each person is
 * contractually bound to deliver, and the progress their own signed report
 * declares. They are deliberately not work items, so contractual percentages
 * never get mixed into the execution tally.
 */
function baseBoard() {
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
			],
		},
		people: [
			{ id: "ana", name: "Ana Ruiz", role: "Backend" },
			{ id: "beto", name: "Beto Díaz", role: "Datos" },
		],
		epics: [{ id: "f1", key: "F1", title: "Base", objective: "Ingesta", startPeriod: 1, duration: 1 }],
		items: [{ id: "t1", key: "F1-a", epic: "f1", title: "Sync", type: "task", status: "done" }],
		deliverables: [],
		milestones: [],
		contracts: [
			{
				id: "ops-1",
				person: "ana",
				number: "480-2026",
				objeto: "Prestar servicios profesionales.",
				startDate: "2026-08-12",
				endDate: "2026-11-30",
				obligations: [
					{ id: "ops-1-1", text: "Diseñar el backend.", progressPeriod: 25, progressAccumulated: 25 },
					{ id: "ops-1-2", text: "Documentar la arquitectura.", progressPeriod: 50, progressAccumulated: 75 },
				],
			},
		],
	};
}

test("validateBoard accepts a board carrying contracts", () => {
	const result = validateBoard(baseBoard());
	assert.deepEqual(result.errors, []);
	assert.equal(result.valid, true);
});

test("validateBoard still accepts a board with no contracts at all", () => {
	const board = baseBoard();
	delete board.contracts;
	assert.equal(validateBoard(board).valid, true);
});

test("validateBoard rejects a contract held by an unknown person", () => {
	const board = baseBoard();
	board.contracts[0].person = "ghost";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("ghost")));
});

test("validateBoard rejects duplicate contract identifiers", () => {
	const board = baseBoard();
	board.contracts.push({ ...board.contracts[0] });
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("duplicate")));
});

test("validateBoard rejects a contract ending before it starts", () => {
	const board = baseBoard();
	board.contracts[0].endDate = "2026-08-01";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("endDate")));
});

test("validateBoard requires at least one obligation per contract", () => {
	const board = baseBoard();
	board.contracts[0].obligations = [];
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("obligations")));
});

test("validateBoard rejects a progress percentage outside zero to a hundred", () => {
	const board = baseBoard();
	board.contracts[0].obligations[0].progressAccumulated = 125;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("progressAccumulated")));
});

test("validateBoard rejects accumulated progress below the current period", () => {
	// Accumulated includes the period, so it can never be the smaller number.
	const board = baseBoard();
	board.contracts[0].obligations[0].progressPeriod = 60;
	board.contracts[0].obligations[0].progressAccumulated = 25;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("accumulated")));
});

test("validateBoard rejects duplicate obligation identifiers inside a contract", () => {
	const board = baseBoard();
	board.contracts[0].obligations[1].id = board.contracts[0].obligations[0].id;
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("duplicate")));
});

test("computeContractProgress averages accumulated progress across obligations", () => {
	const [contract] = baseBoard().contracts;
	const progress = computeContractProgress(contract);
	assert.equal(progress.total, 2);
	assert.equal(progress.percent, 50);
});

test("computeContractProgress counts obligations already at a hundred", () => {
	const [contract] = baseBoard().contracts;
	contract.obligations[1].progressAccumulated = 100;
	const progress = computeContractProgress(contract);
	assert.equal(progress.complete, 1);
	assert.equal(progress.percent, 63);
});

test("contractsByPerson groups contracts under their holder", () => {
	const board = baseBoard();
	const grouped = contractsByPerson(board);
	assert.equal(grouped.get("ana").length, 1);
	assert.equal(grouped.has("beto"), false);
});

test("contractsByPerson returns an empty map when the board carries no contracts", () => {
	const board = baseBoard();
	delete board.contracts;
	assert.equal(contractsByPerson(board).size, 0);
});
