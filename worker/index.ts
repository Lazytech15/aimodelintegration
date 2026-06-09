import {
	WorkflowEntrypoint,
	WorkflowStep,
} from 'cloudflare:workers';
import type { WorkflowEvent } from 'cloudflare:workers';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'error';

type Env = {
	MY_WORKFLOW: Workflow;
	WORKFLOW_STATUS: DurableObjectNamespace;
	RESEND_API_KEY: string;
	ADMIN_EMAIL: string;
	HOTEL_FROM_EMAIL: string;
	WORKER_URL: string;
};

type BookingParams = {
	guestName: string;
	guestEmail: string;
	roomType: string;
	checkIn: string;
	checkOut: string;
	guests: string;
};

// ─────────────────────────────────────────────────────────────────
// Helper: broadcast step status via Durable Object
// Uses fetch() — the only valid way to call a DO stub
// ─────────────────────────────────────────────────────────────────

async function broadcastStep(
	env: Env,
	instanceId: string,
	stepName: string,
	status: StepStatus,
	workflowStatus: 'running' | 'completed' | 'error' = 'running'
) {
	const id = env.WORKFLOW_STATUS.idFromName(instanceId);
	const stub = env.WORKFLOW_STATUS.get(id);

	// Call the DO via fetch — NOT stub.updateStep() (that doesn't exist)
	await stub.fetch('http://internal/broadcast', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			type: 'workflow_update',
			currentStep: stepName,
			stepStatuses: { [stepName]: status },
			workflowStatus,
			timestamp: Date.now(),
		}),
	});
}

// ─────────────────────────────────────────────────────────────────
// Email helper (Resend)
// ─────────────────────────────────────────────────────────────────

async function sendEmail(
	apiKey: string,
	{ from, to, subject, html }: { from: string; to: string; subject: string; html: string }
) {
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ from, to, subject, html }),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Resend error: ${err}`);
	}
}

// ─────────────────────────────────────────────────────────────────
// Booking Workflow
// ─────────────────────────────────────────────────────────────────

export class BookingWorkflow extends WorkflowEntrypoint<Env, BookingParams> {
	async run(event: WorkflowEvent<BookingParams>, step: WorkflowStep) {
		const { guestName, guestEmail, roomType, checkIn, checkOut, guests } = event.payload;
		const instanceId = event.instanceId;
		const fromEmail = this.env.HOTEL_FROM_EMAIL;
		const workerUrl = this.env.WORKER_URL;

		// ── Step 1 ────────────────────────────────────────────────────
		await broadcastStep(this.env, instanceId, 'send confirmation to guest', 'running');
		await step.do('send confirmation to guest', async () => {
			await sendEmail(this.env.RESEND_API_KEY, {
				from: fromEmail,
				to: guestEmail,
				subject: '🏨 Booking Received – Vue sur la Montagne',
				html: `
					<div style="font-family:Georgia,serif;max-width:600px;margin:auto;color:#333">
						<h2 style="color:#1B365D">Hi ${guestName},</h2>
						<p>Thank you for your reservation request at <strong>Vue sur la Montagne Hotel</strong>.</p>
						<table style="width:100%;border-collapse:collapse;margin:20px 0">
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Room</strong></td><td style="padding:8px;border:1px solid #ddd">${roomType}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${checkIn}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${checkOut}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border:1px solid #ddd">${guests}</td></tr>
						</table>
						<p>Our team will confirm within <strong>24 hours</strong>.</p>
						<p style="color:#888;font-size:12px">Booking Ref: ${instanceId}</p>
						<p style="font-size:12px;color:#aaa">Vue sur la Montagne · Rizal, Philippines · +63281234567</p>
					</div>`,
			});
		});
		await broadcastStep(this.env, instanceId, 'send confirmation to guest', 'completed');

		// ── Step 2 ────────────────────────────────────────────────────
		await broadcastStep(this.env, instanceId, 'notify admin', 'running');
		await step.do('notify admin', async () => {
			await sendEmail(this.env.RESEND_API_KEY, {
				from: fromEmail,
				to: this.env.ADMIN_EMAIL,
				subject: `🔔 New Booking – ${guestName} (${roomType})`,
				html: `
					<div style="font-family:Georgia,serif;max-width:600px;margin:auto;color:#333">
						<h2 style="color:#1B365D">New Booking Request</h2>
						<table style="width:100%;border-collapse:collapse;margin:20px 0">
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Guest</strong></td><td style="padding:8px;border:1px solid #ddd">${guestName}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Email</strong></td><td style="padding:8px;border:1px solid #ddd">${guestEmail}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Room</strong></td><td style="padding:8px;border:1px solid #ddd">${roomType}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${checkIn}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${checkOut}</td></tr>
							<tr><td style="padding:8px;border:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border:1px solid #ddd">${guests}</td></tr>
						</table>
						<div style="margin:24px 0">
							<a href="${workerUrl}/admin/approve?id=${instanceId}" style="background:#1B365D;color:#DCCBB5;padding:12px 24px;text-decoration:none;font-size:14px;display:inline-block;margin-right:12px">✅ Approve</a>
							<a href="${workerUrl}/admin/reject?id=${instanceId}" style="background:#8b1a1a;color:#fff;padding:12px 24px;text-decoration:none;font-size:14px;display:inline-block">❌ Reject</a>
						</div>
						<p style="font-size:12px;color:#aaa">Ref: ${instanceId} · Expires in 24 hours</p>
					</div>`,
			});
		});
		await broadcastStep(this.env, instanceId, 'notify admin', 'completed');

		// ── Step 3 ────────────────────────────────────────────────────
		await broadcastStep(this.env, instanceId, 'wait for admin approval', 'waiting');
		let decision: { approved: boolean } = { approved: false };
		try {
			const adminEvent = await step.waitForEvent('wait for admin approval', {
				type: 'admin-decision',
				timeout: '24 hours',
			});
			decision = adminEvent.payload as { approved: boolean };
		} catch {
			decision = { approved: false };
		}
		await broadcastStep(this.env, instanceId, 'wait for admin approval', 'completed');

		// ── Step 4 ────────────────────────────────────────────────────
		await broadcastStep(this.env, instanceId, 'send decision email', 'running');
		await step.do('send decision email', async () => {
			if (decision.approved) {
				await sendEmail(this.env.RESEND_API_KEY, {
					from: fromEmail,
					to: guestEmail,
					subject: '✅ Booking Confirmed – Vue sur la Montagne',
					html: `
						<div style="font-family:Georgia,serif;max-width:600px;margin:auto;color:#333">
							<h2 style="color:#1B365D">Confirmed! 🎉</h2>
							<p>Hi ${guestName}, your stay at <strong>Vue sur la Montagne</strong> is confirmed.</p>
							<table style="width:100%;border-collapse:collapse;margin:20px 0">
								<tr><td style="padding:8px;border:1px solid #ddd"><strong>Room</strong></td><td style="padding:8px;border:1px solid #ddd">${roomType}</td></tr>
								<tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${checkIn} from 2:00 PM</td></tr>
								<tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${checkOut} until 12:00 PM</td></tr>
							</table>
							<p style="font-size:12px;color:#aaa">Vue sur la Montagne · Rizal, Philippines · +63281234567</p>
						</div>`,
				});
			} else {
				await sendEmail(this.env.RESEND_API_KEY, {
					from: fromEmail,
					to: guestEmail,
					subject: 'Update on Your Booking – Vue sur la Montagne',
					html: `
						<div style="font-family:Georgia,serif;max-width:600px;margin:auto;color:#333">
							<h2 style="color:#1B365D">Booking Update</h2>
							<p>Hi ${guestName}, unfortunately we couldn't confirm <strong>${roomType}</strong> on your dates.</p>
							<p>Please contact us: <strong>📞 +63281234567</strong></p>
							<p style="font-size:12px;color:#aaa">Vue sur la Montagne · Rizal, Philippines</p>
						</div>`,
				});
			}
		});
		await broadcastStep(this.env, instanceId, 'send decision email', 'completed');

		// ── Step 5 (approved only) ────────────────────────────────────
		if (decision.approved) {
			await step.sleep('wait before check-in reminder', '23 hours');

			await broadcastStep(this.env, instanceId, 'send check-in reminder', 'running');
			await step.do('send check-in reminder', async () => {
				await sendEmail(this.env.RESEND_API_KEY, {
					from: fromEmail,
					to: guestEmail,
					subject: '🌄 See You Tomorrow! – Vue sur la Montagne',
					html: `
						<div style="font-family:Georgia,serif;max-width:600px;margin:auto;color:#333">
							<h2 style="color:#1B365D">Your stay is tomorrow! 🏨</h2>
							<p>Hi ${guestName}, reminder that your stay begins tomorrow.</p>
							<ul style="line-height:2">
								<li>🕑 Check-in: <strong>${checkIn} from 2:00 PM</strong></li>
								<li>🛏 Room: <strong>${roomType}</strong></li>
								<li>👥 Guests: <strong>${guests}</strong></li>
							</ul>
							<p>📍 Rizal highlands — 45 mins from Manila · 📞 +63281234567</p>
							<p style="font-size:12px;color:#aaa">Vue sur la Montagne · Rizal, Philippines</p>
						</div>`,
				});
			});
			await broadcastStep(this.env, instanceId, 'send check-in reminder', 'completed',  'completed');
		}
	}
}

// ─────────────────────────────────────────────────────────────────
// Durable Object — WebSocket broadcaster
// ─────────────────────────────────────────────────────────────────

export class WorkflowStatusDO implements DurableObject {
	private sessions: Set<WebSocket> = new Set();
	private state: DurableObjectState;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// WebSocket upgrade
		if (url.pathname === '/ws') {
			const upgrade = request.headers.get('Upgrade');
			if (upgrade !== 'websocket') {
				return new Response('Expected WebSocket', { status: 426 });
			}
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
			this.state.acceptWebSocket(server);
			this.sessions.add(server);
			server.addEventListener('close', () => this.sessions.delete(server));
			return new Response(null, { status: 101, webSocket: client });
		}

		// Broadcast to all connected WebSocket clients
		if (url.pathname === '/broadcast' && request.method === 'POST') {
			const message = await request.json();
			const payload = JSON.stringify(message);
			for (const ws of this.sessions) {
				try { ws.send(payload); } catch { this.sessions.delete(ws); }
			}
			return new Response('OK');
		}

		return new Response('Not found', { status: 404 });
	}
}

// ─────────────────────────────────────────────────────────────────
// HTTP Handler
// ─────────────────────────────────────────────────────────────────

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		const cors = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

		// WebSocket → Durable Object
		if (url.pathname === '/ws') {
			const instanceId = url.searchParams.get('instanceId') ?? 'default';
			const stub = env.WORKFLOW_STATUS.get(env.WORKFLOW_STATUS.idFromName(instanceId));
			return stub.fetch(new Request(`http://internal/ws`, req));
		}

		// POST /api/workflow/start — called by BookingSection.jsx
		if (url.pathname === '/api/workflow/start' && req.method === 'POST') {
			try {
				const body = await req.json() as BookingParams;
				if (!body.guestName || !body.guestEmail || !body.checkIn || !body.checkOut) {
					return Response.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
				}
				const instance = await env.MY_WORKFLOW.create({ params: body });
				return Response.json({ instanceId: instance.id, status: 'pending' }, { headers: cors });
			} catch {
				return Response.json({ error: 'Failed to start workflow' }, { status: 500, headers: cors });
			}
		}

		// GET /api/workflow/status?id=...
		if (url.pathname === '/api/workflow/status') {
			const id = url.searchParams.get('id');
			if (!id) return Response.json({ error: 'Missing id' }, { status: 400, headers: cors });
			try {
				const instance = await env.MY_WORKFLOW.get(id);
				return Response.json(await instance.status(), { headers: cors });
			} catch {
				return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
			}
		}

		// GET /admin/approve?id=...
		if (url.pathname === '/admin/approve') {
			const id = url.searchParams.get('id');
			if (!id) return new Response('Missing ID', { status: 400 });
			try {
				const instance = await env.MY_WORKFLOW.get(id);
				await instance.sendEvent({ type: 'admin-decision', payload: { approved: true } });
				return new Response(`<html><body style="font-family:Georgia;text-align:center;padding:60px;color:#1B365D"><h2>✅ Booking Approved!</h2><p>The guest has been notified.</p></body></html>`, {
					headers: { 'Content-Type': 'text/html' },
				});
			} catch {
				return new Response('Not found or already decided.', { status: 404 });
			}
		}

		// GET /admin/reject?id=...
		if (url.pathname === '/admin/reject') {
			const id = url.searchParams.get('id');
			if (!id) return new Response('Missing ID', { status: 400 });
			try {
				const instance = await env.MY_WORKFLOW.get(id);
				await instance.sendEvent({ type: 'admin-decision', payload: { approved: false } });
				return new Response(`<html><body style="font-family:Georgia;text-align:center;padding:60px;color:#8b1a1a"><h2>❌ Booking Rejected</h2><p>The guest has been notified.</p></body></html>`, {
					headers: { 'Content-Type': 'text/html' },
				});
			} catch {
				return new Response('Not found or already decided.', { status: 404 });
			}
		}

		return new Response('Not found', { status: 404, headers: cors });
	},
};