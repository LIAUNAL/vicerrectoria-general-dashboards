/**
 * Rendering layer for the tracking board.
 *
 * Reads `data/board.json` and renders it. All domain rules come from
 * `lib/board.mjs`, which is shared verbatim with the CI check and the Paca
 * seed script, so the dashboard cannot disagree with them.
 *
 * No framework and no build step for the markup: the board must keep working
 * from a plain static host for as long as the data file exists.
 */
import {
	ITEM_STATUSES,
	computeContractProgress,
	computeEpicProgress,
	computeProgramProgress,
	periodRange,
	scheduleBounds,
	validateBoard,
} from "./lib/board.mjs";

const STATUS_LABELS = {
	todo: "Por hacer",
	in_progress: "En curso",
	review: "En revisión",
	blocked: "Bloqueado",
	done: "Hecho",
};

const TYPE_LABELS = {
	epic: "Actividad",
	story: "Historia",
	task: "Tarea",
	spike: "Exploración",
	doc: "Documento",
};

const SEVERITY_LABELS = { low: "Baja", medium: "Media", high: "Alta" };

const MONTHS = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

const statusColor = (status) => `var(--status-${status})`;

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className !== undefined) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function setText(id, value) {
	const node = document.getElementById(id);
	if (node !== null) node.textContent = value ?? "";
}

/** Render an ISO date as a short Spanish date, avoiding locale-dependent output. */
function formatDate(iso) {
	const [year, month, day] = iso.split("-").map(Number);
	return `${day} ${MONTHS[month - 1]} ${year}`;
}

function pill(label, color, soft = false) {
	const node = element("span", soft ? "pill pill--soft" : "pill", label);
	node.style.setProperty("--pill-color", color);
	return node;
}

/**
 * Locate today inside the declared schedule.
 *
 * `current` is null outside the window: a board opened before kickoff or after
 * closure should say so rather than highlight an arbitrary column.
 */
function locateToday(program, today) {
	const periods = program.periods;
	const current = periods.find((period) => period.startDate <= today && today <= period.endDate);
	const elapsed = periods.filter((period) => period.endDate < today).length;
	return { current: current?.index ?? null, elapsed, total: periods.length };
}

function renderHeader(board) {
	const { program } = board;
	const bounds = scheduleBounds(board);
	setText("program-partners", (program.partners ?? []).join(" · "));
	setText("program-name", program.name);
	setText("program-subtitle", program.subtitle ?? program.description ?? "");
	setText("program-indicator", program.indicator);
	setText("program-trl", program.trl ?? "—");
	setText("program-window", `${formatDate(bounds.startDate)} – ${formatDate(bounds.endDate)}`);
	setText("program-updated", board.updatedAt !== undefined ? formatDate(board.updatedAt) : "—");
	document.title = `${program.name} · Tablero de seguimiento`;

	const footer = document.getElementById("footer-source");
	if (footer !== null) {
		footer.textContent = `${program.institution ?? ""} — indicador ${program.indicator}. `;
		if (program.sourceRepository !== undefined) {
			const link = element("a", undefined, "Informe técnico de origen");
			link.href = program.sourceRepository;
			link.rel = "noreferrer";
			footer.append("Fuente: ", link, ".");
		}
	}
}

function renderKpis(board, position) {
	const container = document.getElementById("kpis");
	const progress = computeProgramProgress(board);
	const deliverablesDone = board.deliverables.filter((item) => item.status === "done").length;
	const openBlocking = board.items.filter((item) => item.status === "blocked").length;
	const currentLabel =
		position.current === null
			? position.elapsed >= position.total
				? "Ventana cerrada"
				: "Sin iniciar"
			: periodRange(board.program, position.current).label;

	const kpis = [
		{
			label: "Avance general",
			value: `${progress.percent}%`,
			hint: `${progress.done} de ${progress.total} ítems de trabajo`,
		},
		{
			label: "Entregables",
			value: `${deliverablesDone}/${board.deliverables.length}`,
			hint: "verificados contra su criterio",
		},
		{
			label: "Periodo en curso",
			value: position.current === null ? "—" : `${position.current}/${position.total}`,
			hint: currentLabel,
		},
		{
			label: "Bloqueos",
			value: String(openBlocking),
			hint: openBlocking === 0 ? "ningún ítem bloqueado" : "requieren decisión",
		},
	];

	for (const kpi of kpis) {
		const card = element("div", "kpi");
		card.append(
			element("p", "kpi__label", kpi.label),
			element("p", "kpi__value", kpi.value),
			element("p", "kpi__hint", kpi.hint),
		);
		container.append(card);
	}
}

function renderEpics(board) {
	const container = document.getElementById("epics");
	for (const epic of board.epics) {
		const progress = computeEpicProgress(board, epic.id);
		const color = epic.color ?? "var(--accent)";

		const row = element("article", "epic");
		row.style.setProperty("--epic-color", color);

		const name = element("h3", "epic__name");
		name.append(element("span", "epic__key", epic.key), element("span", undefined, epic.title));

		const count = element("p", "epic__count", `${progress.percent}% · ${progress.done}/${progress.total}`);
		const objective = element("p", "epic__objective", epic.objective);

		// setAttribute rather than the ARIA property reflections, which are still
		// uneven across the browsers this board gets opened in.
		const bar = element("div", "epic__bar");
		bar.setAttribute("role", "progressbar");
		bar.setAttribute("aria-valuenow", String(progress.percent));
		bar.setAttribute("aria-valuemin", "0");
		bar.setAttribute("aria-valuemax", "100");
		bar.setAttribute("aria-label", `Avance de ${epic.title}`);
		const fill = element("div", "epic__fill");
		fill.style.width = `${progress.percent}%`;
		bar.append(fill);

		row.append(name, count, objective, bar);
		container.append(row);
	}
}

/**
 * Build one timeline row: a label plus exactly `total` period cells, where a
 * bar replaces the cells it covers.
 *
 * Emitting cells in order lets the grid place everything by auto-flow, so a
 * span never collides with a background cell.
 */
function timelineRow({ label, labelClass, start, duration, total, color, open, current, barLabel }) {
	const nodes = [];
	const labelCell = element("div", `timeline__label ${labelClass}`);
	labelCell.append(element("span", undefined, label));
	nodes.push(labelCell);

	let period = 1;
	while (period <= total) {
		if (start !== undefined && period === start) {
			const bar = element("div", `timeline__bar${open ? " timeline__bar--open" : ""}`);
			if (labelClass === "timeline__label--epic") bar.classList.add("timeline__bar--epic");
			bar.style.setProperty("--bar-color", color);
			bar.style.gridColumn = `span ${duration}`;
			if (barLabel !== undefined) bar.textContent = barLabel;
			bar.title = `${label} · periodos ${start} a ${start + duration - 1}`;
			nodes.push(bar);
			period += duration;
			continue;
		}
		const cell = element("div", `timeline__cell${period === current ? " timeline__cell--current" : ""}`);
		nodes.push(cell);
		period += 1;
	}
	return nodes;
}

function renderTimeline(board, position) {
	const container = document.getElementById("timeline");
	const { program } = board;
	const total = program.periods.length;
	container.style.setProperty("--periods", String(total));

	container.append(element("div", "timeline__corner"));
	for (const period of program.periods) {
		const head = element(
			"div",
			`timeline__head${period.index === position.current ? " timeline__head--current" : ""}`,
			period.label,
		);
		container.append(head);
	}

	for (const epic of board.epics) {
		const color = epic.color ?? "var(--accent)";
		const progress = computeEpicProgress(board, epic.id);
		container.append(
			...timelineRow({
				label: `${epic.key} · ${epic.title}`,
				labelClass: "timeline__label--epic",
				start: epic.startPeriod,
				duration: epic.duration,
				total,
				color,
				open: progress.percent < 100,
				current: position.current,
				barLabel: `${progress.percent}%`,
			}),
		);

		for (const item of board.items.filter((candidate) => candidate.epic === epic.id)) {
			if (item.startPeriod === undefined || item.duration === undefined) continue;
			container.append(
				...timelineRow({
					label: `${item.key} · ${item.title}`,
					labelClass: "timeline__label--item",
					start: item.startPeriod,
					duration: item.duration,
					total,
					color: item.status === "done" ? color : statusColor(item.status),
					open: item.status !== "done",
					current: position.current,
				}),
			);
		}
	}

	if (board.milestones.length > 0) {
		const labelCell = element("div", "timeline__label timeline__label--epic");
		labelCell.append(element("span", undefined, "Hitos"));
		container.append(labelCell);
		for (const period of program.periods) {
			const milestone = board.milestones.find((candidate) => candidate.period === period.index);
			const cell = element(
				"div",
				`timeline__cell${period.index === position.current ? " timeline__cell--current" : ""}`,
			);
			if (milestone !== undefined) {
				cell.classList.add("timeline__milestone");
				cell.textContent = milestone.status === "done" ? "◆" : "◇";
				cell.title = `${milestone.code ?? "Hito"} · ${milestone.title}`;
			}
			container.append(cell);
		}
	}

	const note = document.getElementById("timeline-note");
	const unit = program.timeUnit === "fortnight" ? "quincenas" : "meses";
	note.textContent =
		`Ejecución en ${total} ${unit}. Las barras rayadas indican trabajo abierto; ` +
		`el rombo lleno, un hito cumplido.`;
}

function renderKanban(board) {
	const container = document.getElementById("kanban");
	const epicFilter = document.getElementById("filter-epic");
	const ownerFilter = document.getElementById("filter-owner");
	const peopleById = new Map(board.people.map((person) => [person.id, person]));
	const epicsById = new Map(board.epics.map((epic) => [epic.id, epic]));

	const addOptions = (select, options) => {
		select.append(element("option", undefined, "Todas"));
		select.firstChild.value = "";
		for (const option of options) {
			const node = element("option", undefined, option.label);
			node.value = option.value;
			select.append(node);
		}
	};
	addOptions(
		epicFilter,
		board.epics.map((epic) => ({ value: epic.id, label: `${epic.key} · ${epic.title}` })),
	);
	addOptions(
		ownerFilter,
		board.people.map((person) => ({ value: person.id, label: person.name })),
	);
	ownerFilter.firstChild.textContent = "Todos";

	const draw = () => {
		container.replaceChildren();
		const items = board.items.filter(
			(item) =>
				(epicFilter.value === "" || item.epic === epicFilter.value) &&
				(ownerFilter.value === "" || item.owner === ownerFilter.value),
		);

		for (const status of ITEM_STATUSES) {
			const inColumn = items.filter((item) => item.status === status);
			const column = element("section", "column");
			column.style.setProperty("--status-color", statusColor(status));

			const head = element("h3", "column__head");
			head.append(
				element("span", "column__dot"),
				element("span", undefined, STATUS_LABELS[status]),
				element("span", "column__count", String(inColumn.length)),
			);
			column.append(head);

			if (inColumn.length === 0) {
				column.append(element("p", "column__empty", "Sin ítems"));
				container.append(column);
				continue;
			}

			const list = element("ul", "column__list");
			for (const item of inColumn) {
				const epic = epicsById.get(item.epic);
				const card = element("li", "card");
				card.style.setProperty("--epic-color", epic?.color ?? "var(--accent)");

				const top = element("div", "card__top");
				top.append(
					element("span", "card__key", item.key),
					element("span", "card__type", TYPE_LABELS[item.type]),
				);

				const meta = element("p", "card__meta");
				if (item.owner !== undefined) {
					meta.append(element("span", undefined, peopleById.get(item.owner)?.name ?? item.owner));
				}
				if (item.startPeriod !== undefined) {
					const range = periodRange(board.program, item.startPeriod);
					meta.append(element("span", undefined, range.label));
				}

				card.append(top, element("h4", "card__title", item.title), meta);
				if (item.notes !== undefined) card.append(element("p", "card__notes", item.notes));
				list.append(card);
			}
			column.append(list);
			container.append(column);
		}
	};

	epicFilter.addEventListener("change", draw);
	ownerFilter.addEventListener("change", draw);
	draw();
}

/**
 * Contracted scope, one card per person.
 *
 * Technical obligations are shown open and administrative ones folded away:
 * the boilerplate every order repeats would otherwise bury the scope that
 * actually distinguishes one contract from another.
 */
function renderContracts(board) {
	const contracts = board.contracts ?? [];
	if (contracts.length === 0) return;
	document.getElementById("contracts-section").hidden = false;

	const container = document.getElementById("contracts");
	const peopleById = new Map(board.people.map((person) => [person.id, person]));
	const epicsById = new Map(board.epics.map((epic) => [epic.id, epic]));

	const obligationRow = (obligation) => {
		const row = element("li", "obligation");
		const bar = element("div", "obligation__bar");
		const fill = element("div", "obligation__fill");
		fill.style.width = `${obligation.progressAccumulated}%`;
		bar.append(fill);
		row.append(
			element("p", "obligation__text", obligation.text),
			element("span", "obligation__pct", `${obligation.progressAccumulated}%`),
			bar,
		);
		return row;
	};

	for (const contract of contracts) {
		const person = peopleById.get(contract.person);
		const epic = epicsById.get(contract.epic);
		const progress = computeContractProgress(contract);
		const color = epic?.color ?? "var(--accent)";

		const card = element("article", "contract");
		card.style.setProperty("--epic-color", color);

		const head = element("div", "contract__head");
		head.append(element("h3", "contract__person", person?.name ?? contract.person));
		if (epic !== undefined) head.append(pill(epic.key, color, true));
		head.append(element("span", "contract__number", contract.number));
		card.append(head);

		card.append(element("p", "contract__role", person?.role ?? ""));

		const meta = element("p", "contract__meta");
		meta.append(
			element("span", undefined, `${formatDate(contract.startDate)} – ${formatDate(contract.endDate)}`),
			element("span", undefined, `${progress.total} obligaciones`),
			element("span", undefined, `${progress.percent}% reportado`),
		);
		card.append(meta);

		const bar = element("div", "epic__bar");
		bar.setAttribute("role", "progressbar");
		bar.setAttribute("aria-valuenow", String(progress.percent));
		bar.setAttribute("aria-valuemin", "0");
		bar.setAttribute("aria-valuemax", "100");
		bar.setAttribute("aria-label", `Avance reportado de ${person?.name ?? contract.person}`);
		const fill = element("div", "epic__fill");
		fill.style.width = `${progress.percent}%`;
		bar.append(fill);
		card.append(bar);

		const technical = contract.obligations.filter((obligation) => obligation.kind !== "administrative");
		const administrative = contract.obligations.filter((obligation) => obligation.kind === "administrative");

		if (technical.length > 0) {
			const list = element("ol", "obligations");
			for (const obligation of technical) list.append(obligationRow(obligation));
			card.append(list);
		}

		if (administrative.length > 0) {
			const details = element("details", "contract__fold");
			details.append(
				element("summary", undefined, `${administrative.length} obligaciones administrativas`),
			);
			const list = element("ol", "obligations");
			for (const obligation of administrative) list.append(obligationRow(obligation));
			details.append(list);
			card.append(details);
		}

		for (const product of contract.products ?? []) {
			const row = element("p", "contract__product");
			row.append(
				pill(STATUS_LABELS[product.status ?? "todo"], statusColor(product.status ?? "todo")),
				element("span", undefined, product.title),
			);
			card.append(row);
		}

		container.append(card);
	}

	setText(
		"contracts-note",
		"Obligaciones y avance tomados de los informes de ejecución firmados. Es una lente distinta " +
			"de la del tablero de trabajo: el porcentaje lo declara cada contratista y no se suma al avance general.",
	);
}

function renderDeliverables(board) {
	const body = document.querySelector("#deliverables tbody");
	const epicsById = new Map(board.epics.map((epic) => [epic.id, epic]));

	for (const deliverable of board.deliverables) {
		const epic = epicsById.get(deliverable.epic);
		const row = element("tr");

		const title = element("td");
		title.append(element("span", "table__title", deliverable.title));
		if (deliverable.location !== undefined) {
			const location = element("code", "table__location", deliverable.location);
			title.append(location);
		}

		const phase = element("td");
		const phasePill = pill(epic?.key ?? deliverable.epic, epic?.color ?? "var(--accent)", true);
		phase.append(phasePill);

		const due = element("td", undefined, periodRange(board.program, deliverable.duePeriod).label);

		const status = element("td");
		status.append(pill(STATUS_LABELS[deliverable.status], statusColor(deliverable.status)));

		row.append(title, phase, due, status, element("td", undefined, deliverable.acceptance ?? "—"));
		body.append(row);
	}
}

function renderMilestones(board) {
	const container = document.getElementById("milestones");
	for (const milestone of board.milestones) {
		const range = periodRange(board.program, milestone.period);
		const row = element("li", "milestone");
		row.append(
			element("span", "milestone__code", milestone.code ?? "·"),
			element("span", "milestone__title", milestone.title),
			element("span", "milestone__when", range.label),
		);
		if (milestone.description !== undefined) {
			row.append(element("p", "milestone__desc", milestone.description));
		}
		container.append(row);
	}
}

function renderFindings(board) {
	const findings = board.findings ?? [];
	if (findings.length === 0) {
		document.getElementById("h-hallazgos").closest(".section").hidden = true;
		return;
	}
	const container = document.getElementById("findings");
	for (const finding of findings) {
		const row = element("li", "finding");
		row.style.setProperty("--severity-color", `var(--severity-${finding.severity})`);
		const head = element("div", "finding__head");
		head.append(
			element("h3", "finding__title", finding.title),
			pill(`Severidad ${SEVERITY_LABELS[finding.severity]}`, `var(--severity-${finding.severity})`, true),
		);
		row.append(head);
		if (finding.detail !== undefined) row.append(element("p", "finding__detail", finding.detail));
		container.append(row);
	}
}

function renderObjectives(board) {
	const { program } = board;
	setText("objective-general", program.generalObjective ?? "");
	const container = document.getElementById("objectives");
	for (const objective of program.specificObjectives ?? []) {
		const row = element("li", "objective");
		const head = element("div", "objective__head");
		head.append(element("span", "objective__code", objective.code));
		if (objective.problem !== undefined) {
			head.append(element("span", "objective__problem", objective.problem));
		}
		row.append(head, element("p", "objective__statement", objective.statement));
		container.append(row);
	}

	const fill = (id, values) => {
		const list = document.getElementById(id);
		for (const value of values ?? []) list.append(element("li", undefined, value));
	};
	fill("scope-in", program.scope);
	fill("scope-out", program.outOfScope);
}

function renderRoadmap(board) {
	const roadmap = board.roadmap;
	if (roadmap === undefined) return;
	document.getElementById("roadmap-section").hidden = false;

	const container = document.getElementById("roadmap");
	const total = roadmap.horizonMonths;
	container.style.setProperty("--periods", String(total));
	container.style.setProperty("--cell-min", "30px");

	container.append(element("div", "timeline__corner"));
	for (let month = 1; month <= total; month += 1) {
		container.append(element("div", "timeline__head", String(month)));
	}

	for (const phase of roadmap.phases) {
		container.append(
			...timelineRow({
				label: phase.title,
				labelClass: "timeline__label--epic",
				start: phase.startMonth,
				duration: phase.durationMonths,
				total,
				color: "var(--slate-600)",
				open: true,
				current: null,
			}),
		);
	}

	const labelCell = element("div", "timeline__label timeline__label--epic");
	labelCell.append(element("span", undefined, "Hitos"));
	container.append(labelCell);
	for (let month = 1; month <= total; month += 1) {
		const milestone = roadmap.milestones.find((candidate) => candidate.month === month);
		const cell = element("div", "timeline__cell");
		if (milestone !== undefined) {
			cell.classList.add("timeline__milestone");
			cell.textContent = "◇";
			cell.title = `${milestone.code ?? "Hito"} · ${milestone.title}`;
		}
		container.append(cell);
	}

	const list = document.getElementById("roadmap-milestones");
	for (const milestone of roadmap.milestones) {
		const row = element("li", "milestone");
		row.append(
			element("span", "milestone__code", milestone.code ?? "·"),
			element("span", "milestone__title", milestone.title),
			element("span", "milestone__when", `Mes ${milestone.month}`),
		);
		list.append(row);
	}

	setText("roadmap-note", roadmap.source ?? "");
}

function fail(message) {
	const node = document.getElementById("load-error");
	node.hidden = false;
	node.textContent = message;
}

async function main() {
	let board;
	try {
		const response = await fetch("./data/board.json", { cache: "no-cache" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		board = await response.json();
	} catch (error) {
		fail(`No se pudo cargar data/board.json: ${error.message}`);
		return;
	}

	const { valid, errors } = validateBoard(board);
	if (!valid) {
		fail(`El archivo de datos no cumple el contrato (${errors.length} problemas): ${errors[0]}`);
		return;
	}

	const today = new Date().toISOString().slice(0, 10);
	const position = locateToday(board.program, today);

	renderHeader(board);
	renderKpis(board, position);
	renderEpics(board);
	renderTimeline(board, position);
	renderKanban(board);
	renderContracts(board);
	renderDeliverables(board);
	renderMilestones(board);
	renderFindings(board);
	renderObjectives(board);
	renderRoadmap(board);
}

await main();
