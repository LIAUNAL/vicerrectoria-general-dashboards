/**
 * Minimal Paca REST client.
 *
 * Two authentication paths, because Paca offers two and they are not
 * interchangeable:
 *
 * - An API key (`paca_` + 64 hex) travels in a header and is the right choice
 *   for automation. It is created from the UI or from a cookie session.
 * - `POST /auth/login` returns no token in the body; it sets HttpOnly cookies.
 *   A script therefore has to keep a cookie jar, which is what this client does.
 *
 * Responses use a `{success, data, request_id}` envelope. `unwrap` tolerates
 * endpoints that answer with the bare payload instead, since the project's own
 * API design document flags that divergence.
 */

const DEFAULT_BASE_URL = "http://localhost:3000/api/v1";

export class PacaError extends Error {
	constructor(message, { status, path, body } = {}) {
		super(message);
		this.name = "PacaError";
		this.status = status;
		this.path = path;
		this.body = body;
	}
}

function unwrap(body) {
	if (body !== null && typeof body === "object" && "success" in body && "data" in body) return body.data;
	return body;
}

export class PacaClient {
	/**
	 * @param {{baseUrl?: string, apiKey?: string}} options
	 */
	constructor({ baseUrl = DEFAULT_BASE_URL, apiKey } = {}) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.apiKey = apiKey;
		/** Cookie jar: name -> value. Enough for the single-host session Paca uses. */
		this.cookies = new Map();
	}

	get authenticated() {
		return this.apiKey !== undefined || this.cookies.has("access_token");
	}

	#headers(hasBody) {
		const headers = { accept: "application/json" };
		if (hasBody) headers["content-type"] = "application/json";
		if (this.apiKey !== undefined) headers.authorization = `ApiKey ${this.apiKey}`;
		if (this.cookies.size > 0) {
			headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
		}
		return headers;
	}

	#storeCookies(response) {
		// getSetCookie keeps multiple Set-Cookie headers separate; a joined
		// header would corrupt any cookie whose value contains a comma.
		for (const raw of response.headers.getSetCookie?.() ?? []) {
			const [pair] = raw.split(";");
			const index = pair.indexOf("=");
			if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
		}
	}

	async request(method, path, body) {
		const url = `${this.baseUrl}${path}`;
		let response;
		try {
			response = await fetch(url, {
				method,
				headers: this.#headers(body !== undefined),
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: "manual",
			});
		} catch (error) {
			throw new PacaError(`cannot reach ${url}: ${error.message}`, { path });
		}

		this.#storeCookies(response);

		const text = await response.text();
		let parsed = null;
		if (text.length > 0) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}

		if (!response.ok) {
			const detail = typeof parsed === "object" && parsed !== null ? (parsed.error ?? JSON.stringify(parsed)) : parsed;
			throw new PacaError(`${method} ${path} failed with HTTP ${response.status}: ${detail}`, {
				status: response.status,
				path,
				body: parsed,
			});
		}

		return unwrap(parsed);
	}

	get(path) {
		return this.request("GET", path);
	}

	post(path, body) {
		return this.request("POST", path, body);
	}

	patch(path, body) {
		return this.request("PATCH", path, body);
	}

	/** Exchange credentials for the session cookies Paca sets on login. */
	async login(username, password) {
		await this.post("/auth/login", { username, password, remember_me: true });
		if (!this.cookies.has("access_token")) {
			throw new PacaError("login succeeded but set no access_token cookie; check the base URL");
		}
	}

	listProjects() {
		return this.get("/projects");
	}

	createProject(payload) {
		return this.post("/projects", payload);
	}

	listTaskTypes(projectId) {
		return this.get(`/projects/${projectId}/task-types`);
	}

	listTaskStatuses(projectId) {
		return this.get(`/projects/${projectId}/task-statuses`);
	}

	listSprints(projectId) {
		return this.get(`/projects/${projectId}/sprints`);
	}

	createSprint(projectId, payload) {
		return this.post(`/projects/${projectId}/sprints`, payload);
	}

	listTasks(projectId) {
		return this.get(`/projects/${projectId}/tasks`);
	}

	createTask(projectId, payload) {
		return this.post(`/projects/${projectId}/tasks`, payload);
	}

	updateTask(projectId, taskId, payload) {
		return this.patch(`/projects/${projectId}/tasks/${taskId}`, payload);
	}

	listMembers(projectId) {
		return this.get(`/projects/${projectId}/members`);
	}
}

/**
 * Build a client from the environment.
 *
 * @throws {PacaError} when no usable credential is present, rather than issuing
 *   anonymous calls that would fail later with a confusing 401.
 */
export async function clientFromEnv(env) {
	const client = new PacaClient({
		baseUrl: env.PACA_BASE_URL ?? DEFAULT_BASE_URL,
		apiKey: env.PACA_API_KEY,
	});

	if (client.apiKey !== undefined) return client;

	if (env.PACA_USERNAME === undefined || env.PACA_PASSWORD === undefined) {
		throw new PacaError(
			"set PACA_API_KEY, or PACA_USERNAME and PACA_PASSWORD, before talking to Paca",
		);
	}
	await client.login(env.PACA_USERNAME, env.PACA_PASSWORD);
	return client;
}

/** Normalize a list response that may arrive bare or wrapped in a named field. */
export function asList(value, ...fields) {
	if (Array.isArray(value)) return value;
	if (value !== null && typeof value === "object") {
		for (const field of fields) {
			if (Array.isArray(value[field])) return value[field];
		}
		for (const candidate of Object.values(value)) {
			if (Array.isArray(candidate)) return candidate;
		}
	}
	return [];
}
