import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ACCENTS, accentVar, validateBoard } from "../lib/board.mjs";

/**
 * Accents are semantic token names, not hex values.
 *
 * Archify resolves each accent to a different colour per theme, so a literal
 * hex stored in the data would stay dark-theme coloured on the light theme.
 */
function baseBoard() {
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
		epics: [
			{ id: "f1", key: "F1", title: "Base", objective: "Ingesta", startPeriod: 1, duration: 1, color: "backend" },
		],
		items: [{ id: "t1", key: "F1-a", epic: "f1", title: "Sync", type: "task", status: "done" }],
		deliverables: [],
		milestones: [],
	};
}

test("ACCENTS lists the Archify semantic families", () => {
	assert.deepEqual(ACCENTS, [
		"frontend",
		"backend",
		"database",
		"cloud",
		"security",
		"messagebus",
		"external",
	]);
});

test("validateBoard accepts an epic carrying a semantic accent", () => {
	assert.deepEqual(validateBoard(baseBoard()).errors, []);
});

test("validateBoard accepts an epic with no accent at all", () => {
	const board = baseBoard();
	delete board.epics[0].color;
	assert.equal(validateBoard(board).valid, true);
});

test("validateBoard rejects a literal hex colour", () => {
	// The whole point of the migration: a hex cannot follow the theme.
	const board = baseBoard();
	board.epics[0].color = "#047857";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("color")));
});

test("validateBoard rejects an accent outside the known families", () => {
	const board = baseBoard();
	board.epics[0].color = "turquoise";
	const result = validateBoard(board);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((error) => error.includes("turquoise")));
});

test("accentVar resolves an accent to its stroke custom property", () => {
	assert.equal(accentVar("backend"), "var(--backend-stroke)");
	assert.equal(accentVar("database"), "var(--database-stroke)");
});

test("accentVar falls back to the emphasis arrow for an absent accent", () => {
	assert.equal(accentVar(undefined), "var(--arrow-emphasis)");
});

test("accentVar refuses an unknown accent rather than emitting a dead variable", () => {
	assert.equal(accentVar("turquoise"), "var(--arrow-emphasis)");
});

test("the published board uses semantic accents everywhere", async () => {
	const path = fileURLToPath(new URL("../data/board.json", import.meta.url));
	const board = JSON.parse(await readFile(path, "utf8"));
	for (const epic of board.epics) {
		assert.ok(
			epic.color === undefined || ACCENTS.includes(epic.color),
			`epic ${epic.key} carries a non-semantic accent: ${epic.color}`,
		);
	}
});
