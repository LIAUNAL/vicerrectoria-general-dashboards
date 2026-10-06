/**
 * Board domain logic for the Vicerrectoría General dashboards tracking board.
 *
 * `data/board.json` is the single source of truth. The static site, the CI data
 * check and the Paca seed script all read it through this module, so the rules
 * live in exactly one place.
 *
 * The schedule is expressed as explicit, one-based periods rather than computed
 * month offsets: the real plan runs in fortnights of uneven length, so every
 * period carries its own calendar span instead of being derived by arithmetic.
 */

/** Closed set of work-item states, in the order the board columns use. */
export const ITEM_STATUSES = ["todo", "in_progress", "review", "blocked", "done"];

/** Closed set of work-item kinds. */
export const ITEM_TYPES = ["epic", "story", "task", "spike", "doc"];

/** Granularity of the tracking schedule. */
export const TIME_UNITS = ["fortnight", "month"];

const REQUIRED_PROGRAM_FIELDS = ["id", "name", "indicator", "timeUnit", "periods"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value) {
	if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}

/** Collect duplicate `id` values so a typo cannot silently merge two rows. */
function collectIds(rows, collection, errors) {
	const seen = new Set();
	rows.forEach((row, index) => {
		const id = row?.id;
		if (!isNonEmptyString(id)) {
			errors.push(`${collection}[${index}].id must be a non-empty string`);
			return;
		}
		if (seen.has(id)) errors.push(`${collection}[${index}].id is a duplicate: ${id}`);
		seen.add(id);
	});
	return seen;
}

function validatePeriods(periods, errors) {
	if (!Array.isArray(periods) || periods.length === 0) {
		errors.push("program.periods must be a non-empty array");
		return 0;
	}
	periods.forEach((period, offset) => {
		const expected = offset + 1;
		if (period?.index !== expected) {
			errors.push(`program.periods[${offset}].index must be ${expected}; periods are contiguous and one-based`);
		}
		if (!isNonEmptyString(period?.label)) {
			errors.push(`program.periods[${offset}].label must be a non-empty string`);
		}
		if (!isIsoDate(period?.startDate)) {
			errors.push(`program.periods[${offset}].startDate must be an ISO date (YYYY-MM-DD)`);
		}
		if (!isIsoDate(period?.endDate)) {
			errors.push(`program.periods[${offset}].endDate must be an ISO date (YYYY-MM-DD)`);
		}
		if (isIsoDate(period?.startDate) && isIsoDate(period?.endDate) && period.endDate < period.startDate) {
			errors.push(`program.periods[${offset}].endDate must not precede its startDate`);
		}
	});
	return periods.length;
}

function validateRoadmap(roadmap, errors) {
	if (roadmap === undefined) return;
	if (!isPlainObject(roadmap)) {
		errors.push("roadmap must be an object when present");
		return;
	}
	const horizon = roadmap.horizonMonths;
	if (!isPositiveInteger(horizon)) {
		errors.push("roadmap.horizonMonths must be a positive integer");
	}
	if (!Array.isArray(roadmap.phases)) {
		errors.push("roadmap.phases must be an array");
	} else {
		roadmap.phases.forEach((phase, index) => {
			if (!isNonEmptyString(phase?.title)) errors.push(`roadmap.phases[${index}].title must be a non-empty string`);
			if (!isPositiveInteger(phase?.startMonth)) {
				errors.push(`roadmap.phases[${index}].startMonth must be a positive integer`);
				return;
			}
			if (!isPositiveInteger(phase?.durationMonths)) {
				errors.push(`roadmap.phases[${index}].durationMonths must be a positive integer`);
				return;
			}
			const end = phase.startMonth + phase.durationMonths - 1;
			if (isPositiveInteger(horizon) && end > horizon) {
				errors.push(`roadmap.phases[${index}] ends at month ${end}, past roadmap.horizonMonths (${horizon})`);
			}
		});
	}
	if (!Array.isArray(roadmap.milestones)) {
		errors.push("roadmap.milestones must be an array");
		return;
	}
	roadmap.milestones.forEach((milestone, index) => {
		if (!isNonEmptyString(milestone?.title)) {
			errors.push(`roadmap.milestones[${index}].title must be a non-empty string`);
		}
		if (!isPositiveInteger(milestone?.month)) {
			errors.push(`roadmap.milestones[${index}].month must be a positive integer`);
			return;
		}
		if (isPositiveInteger(horizon) && milestone.month > horizon) {
			errors.push(`roadmap.milestones[${index}].month (${milestone.month}) exceeds roadmap.horizonMonths (${horizon})`);
		}
	});
}

/**
 * Validate a board document.
 *
 * Every problem found is reported, not just the first, so a single CI run tells
 * the whole story.
 *
 * @param {unknown} board
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateBoard(board) {
	const errors = [];
	if (!isPlainObject(board)) return { valid: false, errors: ["board must be an object"] };

	if (!isNonEmptyString(board.version)) errors.push("version must be a non-empty string");

	const program = board.program;
	let totalPeriods = 0;
	if (!isPlainObject(program)) {
		errors.push("program must be an object");
	} else {
		for (const field of REQUIRED_PROGRAM_FIELDS) {
			if (program[field] === undefined) errors.push(`program.${field} is required`);
		}
		if (program.timeUnit !== undefined && !TIME_UNITS.includes(program.timeUnit)) {
			errors.push(`program.timeUnit must be one of ${TIME_UNITS.join(", ")}`);
		}
		if (program.periods !== undefined) totalPeriods = validatePeriods(program.periods, errors);
	}

	const collections = ["people", "epics", "items", "deliverables", "milestones"];
	const missing = collections.filter((collection) => !Array.isArray(board[collection]));
	for (const collection of missing) errors.push(`${collection} must be an array`);
	if (missing.length > 0) return { valid: false, errors };

	const personIds = collectIds(board.people, "people", errors);
	const epicIds = collectIds(board.epics, "epics", errors);
	collectIds(board.items, "items", errors);
	collectIds(board.deliverables, "deliverables", errors);
	collectIds(board.milestones, "milestones", errors);

	/** Reject a period reference that falls outside the declared schedule. */
	const checkPeriod = (value, label) => {
		if (!isPositiveInteger(value) || (totalPeriods > 0 && value > totalPeriods)) {
			errors.push(`${label} must be an integer between 1 and ${totalPeriods}`);
			return false;
		}
		return true;
	};

	board.people.forEach((person, index) => {
		if (!isNonEmptyString(person.name)) errors.push(`people[${index}].name must be a non-empty string`);
		if (!isNonEmptyString(person.role)) errors.push(`people[${index}].role must be a non-empty string`);
	});

	board.epics.forEach((epic, index) => {
		for (const field of ["key", "title", "objective"]) {
			if (!isNonEmptyString(epic[field])) errors.push(`epics[${index}].${field} must be a non-empty string`);
		}
		if (epic.owner !== undefined && !personIds.has(epic.owner)) {
			errors.push(`epics[${index}].owner is not a known person: ${epic.owner}`);
		}
		const startOk = checkPeriod(epic.startPeriod, `epics[${index}].startPeriod`);
		if (!isPositiveInteger(epic.duration)) {
			errors.push(`epics[${index}].duration must be a positive integer`);
			return;
		}
		if (startOk && totalPeriods > 0) {
			const end = epic.startPeriod + epic.duration - 1;
			if (end > totalPeriods) {
				errors.push(`epics[${index}] ends at period ${end}, past the last period (${totalPeriods})`);
			}
		}
	});

	board.items.forEach((item, index) => {
		for (const field of ["key", "title"]) {
			if (!isNonEmptyString(item[field])) errors.push(`items[${index}].${field} must be a non-empty string`);
		}
		if (!ITEM_STATUSES.includes(item.status)) {
			errors.push(`items[${index}].status must be one of ${ITEM_STATUSES.join(", ")}`);
		}
		if (!ITEM_TYPES.includes(item.type)) {
			errors.push(`items[${index}].type must be one of ${ITEM_TYPES.join(", ")}`);
		}
		if (!epicIds.has(item.epic)) errors.push(`items[${index}].epic is not a known epic: ${item.epic}`);
		if (item.owner !== undefined && !personIds.has(item.owner)) {
			errors.push(`items[${index}].owner is not a known person: ${item.owner}`);
		}
	});

	board.deliverables.forEach((deliverable, index) => {
		if (!isNonEmptyString(deliverable.title)) {
			errors.push(`deliverables[${index}].title must be a non-empty string`);
		}
		if (!ITEM_STATUSES.includes(deliverable.status)) {
			errors.push(`deliverables[${index}].status must be one of ${ITEM_STATUSES.join(", ")}`);
		}
		if (!epicIds.has(deliverable.epic)) {
			errors.push(`deliverables[${index}].epic is not a known epic: ${deliverable.epic}`);
		}
		checkPeriod(deliverable.duePeriod, `deliverables[${index}].duePeriod`);
	});

	board.milestones.forEach((milestone, index) => {
		if (!isNonEmptyString(milestone.title)) {
			errors.push(`milestones[${index}].title must be a non-empty string`);
		}
		checkPeriod(milestone.period, `milestones[${index}].period`);
	});

	validateRoadmap(board.roadmap, errors);

	return { valid: errors.length === 0, errors };
}

function emptyStatusTally() {
	return Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0]));
}

function tally(items) {
	const byStatus = emptyStatusTally();
	for (const item of items) {
		if (item.status in byStatus) byStatus[item.status] += 1;
	}
	const total = items.length;
	const done = byStatus.done;
	return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100), byStatus };
}

/**
 * Completion of a single epic, measured over its own work items.
 *
 * An epic with no items reports zero rather than a hundred: an empty epic is
 * unplanned work, not finished work.
 */
export function computeEpicProgress(board, epicId) {
	return tally(board.items.filter((item) => item.epic === epicId));
}

/** Completion across every work item in the program. */
export function computeProgramProgress(board) {
	return tally(board.items);
}

/**
 * Calendar span of a one-based period index.
 *
 * @throws {RangeError} when the index falls outside the declared periods
 */
export function periodRange(program, index) {
	const period = program.periods?.find((candidate) => candidate.index === index);
	if (period === undefined) {
		throw new RangeError(`period ${index} is outside the declared ${program.periods?.length ?? 0} periods`);
	}
	return { label: period.label, startDate: period.startDate, endDate: period.endDate };
}

/** First and last tracked period, with the calendar dates that bracket them. */
export function scheduleBounds(board) {
	const periods = board.program.periods;
	const first = periods[0];
	const last = periods[periods.length - 1];
	return {
		firstPeriod: first.index,
		lastPeriod: last.index,
		totalPeriods: periods.length,
		startDate: first.startDate,
		endDate: last.endDate,
	};
}
