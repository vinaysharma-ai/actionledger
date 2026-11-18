import { z } from "zod";

export const WorkflowStatus = {
	CREATED: "CREATED",
	RUNNING: "RUNNING",
	WAITING_APPROVAL: "WAITING_APPROVAL",
	PARTIALLY_COMPLETED: "PARTIALLY_COMPLETED",
	SUCCEEDED: "SUCCEEDED",
	FAILED: "FAILED",
	NEEDS_ATTENTION: "NEEDS_ATTENTION",
	CANCELLED: "CANCELLED",
} as const;

export type WorkflowStatus =
	(typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const WorkflowType = {
	CUSTOMER_REFUND: "customer_refund",
} as const;

export type WorkflowType = (typeof WorkflowType)[keyof typeof WorkflowType];

export const ActionStatus = {
	AWAITING_APPROVAL: "AWAITING_APPROVAL",
	READY: "READY",
	RUNNING: "RUNNING",
	RETRY_WAIT: "RETRY_WAIT",
	OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
	RECONCILING: "RECONCILING",
	SUCCEEDED: "SUCCEEDED",
	FAILED: "FAILED",
	DENIED: "DENIED",
	CANCELLED: "CANCELLED",
} as const;

export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];

export const ApprovalStatus = {
	PENDING: "PENDING",
	APPROVED: "APPROVED",
	REJECTED: "REJECTED",
	EXPIRED: "EXPIRED",
	REVOKED: "REVOKED",
} as const;

export type ApprovalStatus =
	(typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ApprovalDecision = {
	APPROVED: "APPROVED",
	REJECTED: "REJECTED",
} as const;

export type ApprovalDecision =
	(typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const PolicyDecision = {
	ALLOW: "ALLOW",
	REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
	DENY: "DENY",
} as const;

export type PolicyDecision =
	(typeof PolicyDecision)[keyof typeof PolicyDecision];

export const ProviderOutcomeKind = {
	SUCCESS: "SUCCESS",
	DEFINITIVE_FAILURE: "DEFINITIVE_FAILURE",
	RETRYABLE_FAILURE: "RETRYABLE_FAILURE",
	OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
} as const;

export type ProviderOutcomeKind =
	(typeof ProviderOutcomeKind)[keyof typeof ProviderOutcomeKind];

export type NormalizedProviderOutcome =
	| {
			kind: typeof ProviderOutcomeKind.SUCCESS;
			providerReference: string;
	  }
	| {
			kind: typeof ProviderOutcomeKind.DEFINITIVE_FAILURE;
			errorCode: string;
	  }
	| {
			kind: typeof ProviderOutcomeKind.RETRYABLE_FAILURE;
			errorCode: string;
	  }
	| {
			kind: typeof ProviderOutcomeKind.OUTCOME_UNKNOWN;
			errorCode?: string;
	  };

export interface WorkflowSummary {
	id: string;
	workflowType: typeof WorkflowType.CUSTOMER_REFUND;
	title: string;
	status: WorkflowStatus;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

const orderNumberSchema = z.string().trim().min(1);

const externalIdentifierSchema = z.string().trim().min(1);

const refundReasonSchema = z.enum(["DAMAGED_ITEM", "OTHER_APPROVED_REASON"]);

export const RefundPaymentProposalSchema = z.strictObject({
	actionType: z.literal("refund_payment"),
	targetType: z.literal("payment"),
	targetId: externalIdentifierSchema,
	parameters: z.strictObject({
		orderNumber: orderNumberSchema,
		amountMinor: z.number().int().positive().safe(),
		currency: z.literal("USD"),
		reasonCode: refundReasonSchema,
	}),
});

export type RefundPaymentProposal = z.infer<typeof RefundPaymentProposalSchema>;

export const UpdateOrderStatusProposalSchema = z.strictObject({
	actionType: z.literal("update_order_status"),
	targetType: z.literal("order"),
	targetId: externalIdentifierSchema,
	parameters: z.strictObject({
		orderNumber: orderNumberSchema,
		newStatus: z.enum(["PARTIALLY_REFUNDED", "REFUNDED"]),
	}),
});

export type UpdateOrderStatusProposal = z.infer<
	typeof UpdateOrderStatusProposalSchema
>;

export const SendCustomerNotificationProposalSchema = z.strictObject({
	actionType: z.literal("send_customer_notification"),
	targetType: z.literal("order"),
	targetId: externalIdentifierSchema,
	parameters: z.strictObject({
		orderNumber: orderNumberSchema,
		templateId: z.literal("REFUND_CONFIRMED"),
	}),
});

export type SendCustomerNotificationProposal = z.infer<
	typeof SendCustomerNotificationProposalSchema
>;

export const ActionProposalSchema = z.discriminatedUnion("actionType", [
	RefundPaymentProposalSchema,
	UpdateOrderStatusProposalSchema,
	SendCustomerNotificationProposalSchema,
]);

export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const CreateWorkflowRequestSchema = z.strictObject({
	workflowType: z.literal("customer_refund"),
	title: z.string().trim().min(1).max(120),
	request: z.strictObject({
		orderNumber: orderNumberSchema,
		customerMessage: z.string().trim().min(1).max(4000),
	}),
});

export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;
