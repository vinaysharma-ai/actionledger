import { describe, expect, it } from "vitest";

import {
	ActionStatus,
	WorkflowStatus,
	type ActionStatus as ActionStatusValue,
} from "@actionledger/contracts";

import {
	canTransitionActionStatus,
	canonicalJsonSerialize,
	deriveWorkflowStatus,
	sha256Fingerprint,
	transitionActionStatus,
} from "../src/index.js";

describe("canonicalJsonSerialize", () => {
	it("sorts object keys recursively", () => {
		expect(
			canonicalJsonSerialize({
				z: 1,
				a: { d: true, c: null },
			}),
		).toBe('{"a":{"c":null,"d":true},"z":1}');
		expect(canonicalJsonSerialize({ b: 2, a: 1 })).toBe(
			canonicalJsonSerialize({ a: 1, b: 2 }),
		);
	});

	it("preserves array element ordering", () => {
		expect(canonicalJsonSerialize([1, 2])).toBe("[1,2]");
		expect(canonicalJsonSerialize([1, 2])).not.toBe(
			canonicalJsonSerialize([2, 1]),
		);
	});

	it("serializes supported primitive values and normalizes negative zero", () => {
		expect(canonicalJsonSerialize([null, true, "x", 2])).toBe(
			'[null,true,"x",2]',
		);
		expect(canonicalJsonSerialize(-0)).toBe("0");
	});

	it("supports plain objects with null prototypes", () => {
		const value = Object.create(null) as Record<string, unknown>;
		value.b = 2;
		value.a = 1;
		expect(canonicalJsonSerialize(value)).toBe('{"a":1,"b":2}');
	});

	it.each([
		["undefined", undefined],
		["symbol", Symbol("unsupported")],
		["function", () => undefined],
		["bigint", 1n],
		["NaN", Number.NaN],
		["positive infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
		["Date", new Date("2026-01-01T00:00:00Z")],
	])("rejects unsupported %s values", (_label, value) => {
		expect(() => canonicalJsonSerialize(value)).toThrow(TypeError);
	});

	it("rejects circular objects and arrays", () => {
		const object: { self?: unknown } = {};
		object.self = object;
		expect(() => canonicalJsonSerialize(object)).toThrow(/circular/);

		const array: unknown[] = [];
		array.push(array);
		expect(() => canonicalJsonSerialize(array)).toThrow(/circular/);
	});

	it("rejects symbol-keyed object properties", () => {
		const value = { a: 1 } as Record<PropertyKey, unknown>;
		value[Symbol("key")] = 2;
		expect(() => canonicalJsonSerialize(value)).toThrow(
			/symbol-keyed properties/,
		);
	});

	it("rejects symbol-keyed array properties", () => {
		const value = [1, 2] as unknown as Record<PropertyKey, unknown>;
		value[Symbol("extra")] = true;
		expect(() => canonicalJsonSerialize(value)).toThrow(
			/symbol-keyed properties/,
		);
	});

	it("rejects sparse arrays", () => {
		const sparse = new Array<unknown>(3);
		sparse[0] = 1;
		sparse[2] = 3;
		expect(() => canonicalJsonSerialize(sparse)).toThrow(/sparse arrays/);
	});

	it("rejects unsupported array properties", () => {
		const value = [1, 2] as unknown as Record<string, unknown>;
		value.extra = true;
		expect(() => canonicalJsonSerialize(value)).toThrow(
			/unsupported array property/,
		);
	});

	it("rejects accessor properties on objects", () => {
		const value = { a: 1 };
		Object.defineProperty(value, "b", {
			enumerable: true,
			get: () => 2,
		});
		expect(() => canonicalJsonSerialize(value)).toThrow(
			/unsupported own property/,
		);
	});

	it("rejects non-enumerable own properties on objects", () => {
		const value = { a: 1 };
		Object.defineProperty(value, "hidden", {
			enumerable: false,
			value: 2,
		});
		expect(() => canonicalJsonSerialize(value)).toThrow(
			/unsupported own property/,
		);
	});

	it("canonicalizes nested objects independently", () => {
		expect(
			canonicalJsonSerialize({
				request: { currency: "USD", amountMinor: 5000 },
				metadata: { tags: ["refund", "damaged"], verified: true },
			}),
		).toBe(
			'{"metadata":{"tags":["refund","damaged"],"verified":true},"request":{"amountMinor":5000,"currency":"USD"}}',
		);
	});
});

describe("sha256Fingerprint", () => {
	it("produces a lowercase SHA-256 hex digest", () => {
		expect(sha256Fingerprint({ b: 2, a: 1 })).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is unaffected by object key order", () => {
		expect(
			sha256Fingerprint({
				orderNumber: "ORD-1042",
				amountMinor: 50000,
				currency: "USD",
			}),
		).toBe(
			sha256Fingerprint({
				currency: "USD",
				amountMinor: 50000,
				orderNumber: "ORD-1042",
			}),
		);
	});

	it("produces different fingerprints for array reordering", () => {
		expect(sha256Fingerprint([1, 2, 3])).not.toBe(sha256Fingerprint([3, 2, 1]));
	});

	it("produces different fingerprints for materially different values", () => {
		const baseline = {
			orderNumber: "ORD-1042",
			amountMinor: 50000,
			currency: "USD",
		};
		expect(sha256Fingerprint(baseline)).not.toBe(
			sha256Fingerprint({ ...baseline, amountMinor: 49999 }),
		);
		expect(sha256Fingerprint(baseline)).not.toBe(
			sha256Fingerprint({ ...baseline, currency: "EUR" }),
		);
	});

	it("uses safe canonical validation", () => {
		expect(() => sha256Fingerprint({ invalid: undefined })).toThrow(TypeError);
	});
});

const actionStatuses = [
	ActionStatus.AWAITING_APPROVAL,
	ActionStatus.READY,
	ActionStatus.RUNNING,
	ActionStatus.RETRY_WAIT,
	ActionStatus.OUTCOME_UNKNOWN,
	ActionStatus.RECONCILING,
	ActionStatus.SUCCEEDED,
	ActionStatus.FAILED,
	ActionStatus.DENIED,
	ActionStatus.CANCELLED,
] as const satisfies readonly ActionStatusValue[];

const allowedActionTransitions: Readonly<
	Partial<Record<ActionStatusValue, readonly ActionStatusValue[]>>
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
};

describe("action status transitions", () => {
	it("exhaustively evaluates every possible pair of action statuses", () => {
		for (const currentStatus of actionStatuses) {
			for (const nextStatus of actionStatuses) {
				const allowed =
					allowedActionTransitions[currentStatus]?.includes(nextStatus) ??
					false;

				expect(
					canTransitionActionStatus(currentStatus, nextStatus),
					`${currentStatus} -> ${nextStatus}`,
				).toBe(allowed);

				if (allowed) {
					expect(transitionActionStatus(currentStatus, nextStatus)).toBe(
						nextStatus,
					);
				} else {
					expect(
						() => transitionActionStatus(currentStatus, nextStatus),
						`${currentStatus} -> ${nextStatus}`,
					).toThrow(/Invalid action status transition/);
				}
			}
		}
	});

	it("treats terminal states as immutable", () => {
		for (const terminalStatus of [
			ActionStatus.SUCCEEDED,
			ActionStatus.FAILED,
			ActionStatus.DENIED,
			ActionStatus.CANCELLED,
		] as const) {
			for (const nextStatus of actionStatuses) {
				expect(canTransitionActionStatus(terminalStatus, nextStatus)).toBe(
					false,
				);
			}
		}
	});

	it("rejects an invalid runtime status", () => {
		expect(
			canTransitionActionStatus(
				"UNKNOWN" as (typeof ActionStatus)[keyof typeof ActionStatus],
				ActionStatus.READY,
			),
		).toBe(false);
	});
});

describe("deriveWorkflowStatus", () => {
	it("derives CREATED for an empty workflow", () => {
		expect(deriveWorkflowStatus([])).toBe(WorkflowStatus.CREATED);
	});

	it("derives NEEDS_ATTENTION from an OUTCOME_UNKNOWN action before approval", () => {
		expect(
			deriveWorkflowStatus([
				ActionStatus.OUTCOME_UNKNOWN,
				ActionStatus.AWAITING_APPROVAL,
				ActionStatus.RUNNING,
			]),
		).toBe(WorkflowStatus.NEEDS_ATTENTION);
	});

	it("derives WAITING_APPROVAL before active execution states", () => {
		expect(
			deriveWorkflowStatus([
				ActionStatus.AWAITING_APPROVAL,
				ActionStatus.RUNNING,
				ActionStatus.RETRY_WAIT,
			]),
		).toBe(WorkflowStatus.WAITING_APPROVAL);
	});

	it.each([
		[ActionStatus.RUNNING],
		[ActionStatus.READY],
		[ActionStatus.RETRY_WAIT],
		[ActionStatus.RECONCILING],
	])("derives RUNNING for active status %s", (...statuses) => {
		expect(deriveWorkflowStatus(statuses)).toBe(WorkflowStatus.RUNNING);
	});

	it("derives SUCCEEDED only when every action succeeded", () => {
		expect(
			deriveWorkflowStatus([ActionStatus.SUCCEEDED, ActionStatus.SUCCEEDED]),
		).toBe(WorkflowStatus.SUCCEEDED);
	});

	it("derives PARTIALLY_COMPLETED for successful plus terminal outcomes", () => {
		expect(
			deriveWorkflowStatus([ActionStatus.SUCCEEDED, ActionStatus.FAILED]),
		).toBe(WorkflowStatus.PARTIALLY_COMPLETED);
		expect(
			deriveWorkflowStatus([
				ActionStatus.SUCCEEDED,
				ActionStatus.DENIED,
				ActionStatus.CANCELLED,
			]),
		).toBe(WorkflowStatus.PARTIALLY_COMPLETED);
	});

	it("derives CANCELLED only when every action is cancelled", () => {
		expect(
			deriveWorkflowStatus([ActionStatus.CANCELLED, ActionStatus.CANCELLED]),
		).toBe(WorkflowStatus.CANCELLED);
	});

	it("derives FAILED for other fully terminal unsuccessful workflows", () => {
		expect(
			deriveWorkflowStatus([ActionStatus.FAILED, ActionStatus.DENIED]),
		).toBe(WorkflowStatus.FAILED);
		expect(
			deriveWorkflowStatus([ActionStatus.CANCELLED, ActionStatus.FAILED]),
		).toBe(WorkflowStatus.FAILED);
	});
});
