#!/usr/bin/env node
/**
 * Validate data/board.json and print a short summary.
 *
 * CI runs this on every push, so a malformed board fails the pipeline instead
 * of silently producing a broken dashboard.
 */
import { readFile } from "node:fs/promises";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { computeEpicProgress, computeProgramProgress, scheduleBounds, validateBoard } from "../lib/board.mjs";

const DEFAULT_BOARD = fileURLToPath(new URL("../data/board.json", import.meta.url));

async function main() {
	const path = argv[2] ?? DEFAULT_BOARD;

	let board;
	try {
		board = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		stdout.write(`FAIL  cannot read ${path}\n      ${error.message}\n`);
		return 1;
	}

	const { valid, errors } = validateBoard(board);
	if (!valid) {
		stdout.write(`FAIL  ${errors.length} problem(s) in ${path}\n`);
		for (const message of errors) stdout.write(`      - ${message}\n`);
		return 1;
	}

	const progress = computeProgramProgress(board);
	const bounds = scheduleBounds(board);
	const unit = `${board.program.timeUnit}s`;
	stdout.write(`OK    ${path}\n`);
	stdout.write(`      program      ${board.program.name} (${board.program.indicator})\n`);
	stdout.write(`      window       ${bounds.startDate} -> ${bounds.endDate} (${bounds.totalPeriods} ${unit})\n`);
	stdout.write(`      people       ${board.people.length}\n`);
	stdout.write(`      epics        ${board.epics.length}\n`);
	stdout.write(`      items        ${progress.total} (${progress.done} done, ${progress.percent}%)\n`);
	stdout.write(`      deliverables ${board.deliverables.length}\n`);
	stdout.write(`      milestones   ${board.milestones.length}\n`);
	if (board.roadmap !== undefined) {
		stdout.write(
			`      roadmap      ${board.roadmap.horizonMonths} months, ` +
				`${board.roadmap.phases.length} phases, ${board.roadmap.milestones.length} milestones\n`,
		);
	}
	for (const epic of board.epics) {
		const epicProgress = computeEpicProgress(board, epic.id);
		stdout.write(
			`      ${epic.key.padEnd(6)} ${String(epicProgress.percent).padStart(3)}%  ` +
				`${epicProgress.done}/${epicProgress.total}  ${epic.title}\n`,
		);
	}
	return 0;
}

exit(await main());
