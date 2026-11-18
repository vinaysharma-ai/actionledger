import { createHash } from "node:crypto";

import {
	ActionStatus,
	WorkflowStatus,
	type ActionStatus as ActionStatusValue,
	type WorkflowStatus as WorkflowStatusValue,
} from "@actionledger/contracts";

type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

function assertSupportedJsonValue(
	value: unknown,
	seen: ReadonlySet<object>,
	path: string,
): asserts value is JsonValue {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return;
	}

	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(
				`Invalid JSON number at ${path}: value must be finite`,
			);
		}
		return;
	}

	if (Array.isArray(value)) {
		if (seen.has(value)) {
			throw new TypeError(`Invalid JSON value at ${path}: circular reference`);
		}

		const arrayPrototype = Object.getPrototypeOf(value);
		if (arrayPrototype !== Array.prototype) {
			throw new TypeError(
				`Invalid JSON value at ${path}: arrays must have the Array prototype`,
			);
		}
		if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
			throw new TypeError(
				`Invalid JSON value at ${path}: symbol-keyed properties are not valid JSON data`,
			);
		}
		for (const key of Reflect.ownKeys(value)) {
			if (key === "length") {
				continue;
			}
			if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
				throw new TypeError(
					`Invalid JSON value at ${path}: unsupported array property ${String(key)}`,
				);
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined ||
				descriptor.enumerable !== true ||
				!("value" in descriptor)
			) {
				throw new TypeError(
					`Invalid JSON value at ${path}: array properties must be enumerable data properties`,
				);
			}
			const index = Number(key);
			if (!Number.isSafeInteger(index) || index >= value.length) {
				throw new TypeError(
					`Invalid JSON value at ${path}: unsupported array property ${key}`,
				);
			}
		}
		const nextSeen = new Set(seen);
		nextSeen.add(value);
		for (let index = 0; index < value.length; index += 1) {
			if (!Object.hasOwn(value, index)) {
				throw new TypeError(
					`Invalid JSON value at ${path}: sparse arrays are not supported`,
				);
			}
			assertSupportedJsonValue(value[index], nextSeen, `${path}[${index}]`);
		}
		return;
	}

	if (typeof value === "object") {
		if (seen.has(value)) {
			throw new TypeError(`Invalid JSON value at ${path}: circular reference`);
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(
				`Invalid JSON value at ${path}: objects must have a plain object prototype`,
			);
		}

		const nextSeen = new Set(seen);
		nextSeen.add(value);
		if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
			throw new TypeError(
				`Invalid JSON value at ${path}: symbol-keyed properties are not valid JSON data`,
			);
		}
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") {
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined ||
				descriptor.enumerable !== true ||
				!("value" in descriptor)
			) {
				throw new TypeError(
					`Invalid JSON value at ${path}.${key}: unsupported own property`,
				);
			}
			const child = descriptor.value as unknown;
			assertSupportedJsonValue(child, nextSeen, `${path}.${key}`);
		}
		return;
	}

	throw new TypeError(
		`Invalid JSON value at ${path}: ${typeof value} is not supported`,
	);
}

function serializeCanonicalValue(value: JsonValue): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "boolean" || typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (Object.is(value, -0)) {
			return "0";
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => serializeCanonicalValue(item)).join(",")}]`;
	}

	const entries = Object.entries(value)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(
			([key, child]) =>
				`${JSON.stringify(key)}:${serializeCanonicalValue(child)}`,
		);
	return `{${entries.join(",")}}`;
}

/** Returns deterministic JSON with recursively sorted object keys. */
export function canonicalJsonSerialize(value: unknown): string {
	assertSupportedJsonValue(value, new Set(), "$");
	return serializeCanonicalValue(value);
}

/** Returns the lowercase hexadecimal SHA-256 fingerprint of canonical JSON. */
export function sha256Fingerprint(value: unknown): string {
	return createHash("sha256")
		.update(canonicalJsonSerialize(value), "utf8")
		.digest("hex");
}

const allowedActionTransitions: Readonly<
	Record<ActionStatusValue, readonly ActionStatusValue[]>
> = {
	[ActionStatus.AWAITING_APPROVAL]: [
		ActionStatus.READY,
		ActionStatus.DENIED,
		ActionStatus.CANCELLED,
	],
	[ActionStatus.READY]: [ActionStatus.RUNNING, ActionStatus.CANCELLED],
	[ActionStatus.RUNNING]: [
		ActionStatus.SUCCEEDED,
		ActionStatus.RETRY_WAIT,
		ActionStatus.OUTCOME_UNKNOWN,
		ActionStatus.FAILED,
	],
	[ActionStatus.RETRY_WAIT]: [ActionStatus.READY, ActionStatus.CANCELLED],
	[ActionStatus.OUTCOME_UNKNOWN]: [ActionStatus.RECONCILING],
	[ActionStatus.RECONCILING]: [
		ActionStatus.SUCCEEDED,
		ActionStatus.READY,
		ActionStatus.FAILED,
		ActionStatus.OUTCOME_UNKNOWN,
	],
	[ActionStatus.SUCCEEDED]: [],
	[ActionStatus.FAILED]: [],
	[ActionStatus.DENIED]: [],
	[ActionStatus.CANCELLED]: [],
};

/** Returns whether an action can legally move between the two approved states. */
export function canTransitionActionStatus(
	currentStatus: ActionStatusValue,
	nextStatus: ActionStatusValue,
): boolean {
	return allowedActionTransitions[currentStatus]?.includes(nextStatus) ?? false;
}

/** Validates an action transition and returns the target status. */
export function transitionActionStatus(
	currentStatus: ActionStatusValue,
	nextStatus: ActionStatusValue,
): ActionStatusValue {
	if (!canTransitionActionStatus(currentStatus, nextStatus)) {
		throw new Error(
			`Invalid action status transition: ${currentStatus} -> ${nextStatus}`,
		);
	}
	return nextStatus;
}

/** Derives a workflow summary status from its current action states. */
export function deriveWorkflowStatus(
	actionStatuses: readonly ActionStatusValue[],
): WorkflowStatusValue {
	if (actionStatuses.length === 0) {
		return WorkflowStatus.CREATED;
	}
	if (
		actionStatuses.some((status) => status === ActionStatus.OUTCOME_UNKNOWN)
	) {
		return WorkflowStatus.NEEDS_ATTENTION;
	}
	if (
		actionStatuses.some((status) => status === ActionStatus.AWAITING_APPROVAL)
	) {
		return WorkflowStatus.WAITING_APPROVAL;
	}
	if (actionStatuses.every((status) => status === ActionStatus.SUCCEEDED)) {
		return WorkflowStatus.SUCCEEDED;
	}
	if (
		actionStatuses.some(
			(status) =>
				status === ActionStatus.RUNNING ||
				status === ActionStatus.READY ||
				status === ActionStatus.RETRY_WAIT ||
				status === ActionStatus.RECONCILING,
		)
	) {
		return WorkflowStatus.RUNNING;
	}
	if (actionStatuses.some((status) => status === ActionStatus.SUCCEEDED)) {
		const hasOtherTerminalOutcome = actionStatuses.some(
			(status) =>
				status === ActionStatus.FAILED ||
				status === ActionStatus.DENIED ||
				status === ActionStatus.CANCELLED,
		);
		return hasOtherTerminalOutcome
			? WorkflowStatus.PARTIALLY_COMPLETED
			: WorkflowStatus.SUCCEEDED;
	}
	if (actionStatuses.every((status) => status === ActionStatus.CANCELLED)) {
		return WorkflowStatus.CANCELLED;
	}
	if (
		actionStatuses.some(
			(status) =>
				status === ActionStatus.FAILED || status === ActionStatus.DENIED,
		)
	) {
		return WorkflowStatus.FAILED;
	}

	return WorkflowStatus.CREATED;
}
