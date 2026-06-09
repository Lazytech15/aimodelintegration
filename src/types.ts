/**
 * Shared TypeScript types for the Workflows starter template
 */

export type StepStatus =
	| 'pending'
	| 'running'
	| 'waiting'
	| 'completed'
	| 'error';

export type WorkflowStatus = 'idle' | 'running' | 'completed' | 'error';

export interface StepDefinition {
	id: string;
	name: string;
	description: string;
	lineRange: [number, number];
}

export interface WorkflowState {
	instanceId: string | null;
	currentStep: string | null;
	stepStatuses: Record<string, StepStatus>;
	workflowStatus: WorkflowStatus;
	wsConnected: boolean;
}

export interface WorkflowUpdateMessage {
	type: 'workflow_update';
	currentStep: string | null;
	stepStatuses: Record<string, StepStatus>;
	workflowStatus: 'running' | 'completed' | 'error';
	timestamp: number;
}

// ── Hotel Booking Workflow Steps ──────────────────────────────────
// These match the steps defined in worker/index.ts BookingWorkflow
export const WORKFLOW_STEPS: StepDefinition[] = [
	{
		id: 'send-confirmation',
		name: 'send confirmation to guest',
		description: 'Email guest that booking was received',
		lineRange: [1, 8],
	},
	{
		id: 'notify-admin',
		name: 'notify admin',
		description: 'Send approve/reject link to admin',
		lineRange: [10, 18],
	},
	{
		id: 'wait-for-approval',
		name: 'wait for admin approval',
		description: 'Pause for external events (up to 24hrs)',
		lineRange: [20, 24],
	},
	{
		id: 'send-decision',
		name: 'send decision email',
		description: 'Notify guest of approval or rejection',
		lineRange: [26, 34],
	},
	{
		id: 'send-reminder',
		name: 'send check-in reminder',
		description: 'Remind guest 1 day before arrival',
		lineRange: [36, 42],
	},
];