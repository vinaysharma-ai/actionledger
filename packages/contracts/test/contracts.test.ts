import { describe, expect, it } from "vitest";

import {
	ActionProposalSchema,
	CreateWorkflowRequestSchema,
	RefundPaymentProposalSchema,
	SendCustomerNotificationProposalSchema,
	UpdateOrderStatusProposalSchema,
} from "../src/index.js";

const validRequest = {
	workflowType: "customer_refund",
	title: "Damaged item refund - ORD-1042",
	request: {
		orderNumber: "ORD-1042",
		customerMessage: "My order arrived damaged.",
	},
};

describe("CreateWorkflowRequestSchema", () => {
	it("accepts a valid refund workflow request", () => {
		expect(CreateWorkflowRequestSchema.parse(validRequest)).toEqual(
			validRequest,
		);
	});

	it("rejects an unknown workflow type", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				workflowType: "subscription_change",
			}),
		).toThrow();
	});

	it("accepts an order number without a hardcoded ORD- prefix", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: { ...validRequest.request, orderNumber: "1042" },
			}),
		).not.toThrow();
	});

	it("rejects unexpected request properties", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: {
					...validRequest.request,
					providerCredential: "secret",
				},
			}),
		).toThrow();
	});

	it("rejects empty titles and overlong customer messages", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({ ...validRequest, title: " " }),
		).toThrow();
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: {
					...validRequest.request,
					customerMessage: "x".repeat(4001),
				},
			}),
		).toThrow();
	});

	it("accepts 4,000 customer-message characters", () => {
		expect(
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: {
					...validRequest.request,
					customerMessage: "x".repeat(4000),
				},
			}),
		).toBeTruthy();
	});

	it("rejects 4,001 customer-message characters", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: {
					...validRequest.request,
					customerMessage: "x".repeat(4001),
				},
			}),
		).toThrow();
	});

	it("enforces title boundaries", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({ ...validRequest, title: "" }),
		).toThrow();
		expect(
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				title: "t".repeat(120),
			}),
		).toBeTruthy();
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				title: "t".repeat(121),
			}),
		).toThrow();
	});

	it("enforces order-number and target-id minimums", () => {
		expect(() =>
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: { ...validRequest.request, orderNumber: " " },
			}),
		).toThrow();
		expect(
			CreateWorkflowRequestSchema.parse({
				...validRequest,
				request: {
					...validRequest.request,
					orderNumber: "x".repeat(1000),
				},
			}),
		).toBeTruthy();
		expect(
			RefundPaymentProposalSchema.parse({
				actionType: "refund_payment",
				targetType: "payment",
				targetId: "opaque/provider$id-123",
				parameters: {
					orderNumber: "plain-order-identifier",
					amountMinor: 5000,
					currency: "USD",
					reasonCode: "DAMAGED_ITEM",
				},
			}),
		).toBeTruthy();
		expect(() =>
			RefundPaymentProposalSchema.parse({
				actionType: "refund_payment",
				targetType: "payment",
				targetId: " ",
				parameters: {
					orderNumber: "plain-order-identifier",
					amountMinor: 5000,
					currency: "USD",
					reasonCode: "DAMAGED_ITEM",
				},
			}),
		).toThrow();
		expect(
			RefundPaymentProposalSchema.parse({
				actionType: "refund_payment",
				targetType: "payment",
				targetId: "t".repeat(1000),
				parameters: {
					orderNumber: "plain-order-identifier",
					amountMinor: 5000,
					currency: "USD",
					reasonCode: "DAMAGED_ITEM",
				},
			}),
		).toBeTruthy();
	});
});

describe("refund_payment proposal", () => {
	const proposal = {
		actionType: "refund_payment",
		targetType: "payment",
		targetId: "PAY-1042",
		parameters: {
			orderNumber: "ORD-1042",
			amountMinor: 50000,
			currency: "USD",
			reasonCode: "DAMAGED_ITEM",
		},
	};

	it("accepts a valid refund proposal", () => {
		expect(RefundPaymentProposalSchema.parse(proposal)).toEqual(proposal);
	});

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid amountMinor %s",
		(amountMinor) => {
			expect(() =>
				RefundPaymentProposalSchema.parse({
					...proposal,
					parameters: { ...proposal.parameters, amountMinor },
				}),
			).toThrow();
		},
	);

	it("rejects a wrong currency", () => {
		expect(() =>
			RefundPaymentProposalSchema.parse({
				...proposal,
				parameters: { ...proposal.parameters, currency: "EUR" },
			}),
		).toThrow();
	});

	it("rejects a wrong target type", () => {
		expect(() =>
			RefundPaymentProposalSchema.parse({
				...proposal,
				targetType: "order",
			}),
		).toThrow();
	});

	it("rejects an unknown reason code and unexpected properties", () => {
		expect(() =>
			RefundPaymentProposalSchema.parse({
				...proposal,
				parameters: {
					...proposal.parameters,
					reasonCode: "FRAUD_REFUND",
				},
			}),
		).toThrow();
		expect(() =>
			RefundPaymentProposalSchema.parse({
				...proposal,
				providerCredential: "secret",
			}),
		).toThrow();
	});
});

describe("update_order_status proposal", () => {
	const proposal = {
		actionType: "update_order_status",
		targetType: "order",
		targetId: "ORD-1042",
		parameters: {
			orderNumber: "ORD-1042",
			newStatus: "PARTIALLY_REFUNDED",
		},
	};

	it("accepts both allowed order statuses", () => {
		expect(UpdateOrderStatusProposalSchema.parse(proposal)).toEqual(proposal);
		expect(
			UpdateOrderStatusProposalSchema.parse({
				...proposal,
				parameters: { ...proposal.parameters, newStatus: "REFUNDED" },
			}),
		).toBeTruthy();
	});

	it("rejects a wrong target type", () => {
		expect(() =>
			UpdateOrderStatusProposalSchema.parse({
				...proposal,
				targetType: "payment",
			}),
		).toThrow();
	});

	it("rejects an unknown status and unexpected properties", () => {
		expect(() =>
			UpdateOrderStatusProposalSchema.parse({
				...proposal,
				parameters: { ...proposal.parameters, newStatus: "SHIPPED" },
			}),
		).toThrow();
		expect(() =>
			UpdateOrderStatusProposalSchema.parse({
				...proposal,
				functionName: "updateDatabase",
			}),
		).toThrow();
	});
});

describe("send_customer_notification proposal", () => {
	const proposal = {
		actionType: "send_customer_notification",
		targetType: "order",
		targetId: "ORD-1042",
		parameters: {
			orderNumber: "ORD-1042",
			templateId: "REFUND_CONFIRMED",
		},
	};

	it("accepts a valid notification proposal", () => {
		expect(SendCustomerNotificationProposalSchema.parse(proposal)).toEqual(
			proposal,
		);
	});

	it("rejects a wrong target type", () => {
		expect(() =>
			SendCustomerNotificationProposalSchema.parse({
				...proposal,
				targetType: "payment",
			}),
		).toThrow();
	});

	it("rejects an unknown template and arbitrary URL", () => {
		expect(() =>
			SendCustomerNotificationProposalSchema.parse({
				...proposal,
				parameters: {
					...proposal.parameters,
					templateId: "MARKETING_MESSAGE",
				},
			}),
		).toThrow();
		expect(() =>
			SendCustomerNotificationProposalSchema.parse({
				...proposal,
				providerUrl: "https://example.com",
			}),
		).toThrow();
	});
});

describe("ActionProposalSchema", () => {
	it("rejects unknown action types", () => {
		expect(() =>
			ActionProposalSchema.parse({
				actionType: "issue_store_credit",
				targetType: "payment",
				targetId: "PAY-1042",
				parameters: {},
			}),
		).toThrow();
	});

	it("rejects caller-controlled execution status", () => {
		expect(() =>
			ActionProposalSchema.parse({
				actionType: "refund_payment",
				targetType: "payment",
				targetId: "PAY-1042",
				status: "SUCCEEDED",
				parameters: {
					orderNumber: "ORD-1042",
					amountMinor: 5000,
					currency: "USD",
					reasonCode: "DAMAGED_ITEM",
				},
			}),
		).toThrow();
	});

	it("accepts each registered proposal type", () => {
		const proposals = [
			{
				actionType: "refund_payment",
				targetType: "payment",
				targetId: "PAY-1042",
				parameters: {
					orderNumber: "ORD-1042",
					amountMinor: 5000,
					currency: "USD",
					reasonCode: "OTHER_APPROVED_REASON",
				},
			},
			{
				actionType: "update_order_status",
				targetType: "order",
				targetId: "ORD-1042",
				parameters: {
					orderNumber: "ORD-1042",
					newStatus: "REFUNDED",
				},
			},
			{
				actionType: "send_customer_notification",
				targetType: "order",
				targetId: "ORD-1042",
				parameters: {
					orderNumber: "ORD-1042",
					templateId: "REFUND_CONFIRMED",
				},
			},
		];

		for (const proposal of proposals) {
			expect(ActionProposalSchema.parse(proposal)).toEqual(proposal);
		}
	});
});
