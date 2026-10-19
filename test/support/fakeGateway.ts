import { WebSocket, WebSocketServer } from 'ws';

interface FakeConnection {
	path: string;
	received: Array<{ op: number; d: unknown }>;
	receivedAt: number[];
	helloAt: number;
	closeCode?: number;
}

export class FakeGateway {
	heartbeatIntervalMs = 100;
	onIdentify: 'ready' | { closeWith: number } = 'ready';
	onResume: 'resumed' | 'invalid' = 'resumed';
	ackHeartbeats = true;
	sendHello = true;
	malformedIdentifyReplies = 0;
	closeAfterReady: number | null = null;
	rejectResumes = false;
	connections: FakeConnection[] = [];

	private server: WebSocketServer | null = null;
	private baseUrl = '';
	private lastPort = 0;
	private sockets = new Set<WebSocket>();
	private sequence = 0;
	private sessions = 0;

	get port(): number {
		return this.lastPort;
	}

	get openConnections(): number {
		return this.sockets.size;
	}

	async start(port?: number): Promise<string> {
		const server = new WebSocketServer({ host: '127.0.0.1', port: port ?? 0 });
		this.server = server;
		await new Promise<void>((resolve) => server.once('listening', () => resolve()));
		this.lastPort = (server.address() as { port: number }).port;
		this.baseUrl = `ws://127.0.0.1:${this.lastPort}`;
		server.on('connection', (socket, request) => this.accept(socket, request.url ?? '/'));
		return this.baseUrl;
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (!server) return;
		for (const socket of this.sockets) socket.terminate();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	sendToAll(payload: object): void {
		for (const socket of this.sockets) this.send(socket, payload);
	}

	closeAll(code: number): void {
		for (const socket of this.sockets) socket.close(code);
	}

	dispatch(t: string, d: object): void {
		this.sendToAll({ op: 0, t, s: ++this.sequence, d });
	}

	private accept(socket: WebSocket, url: string): void {
		const connection: FakeConnection = {
			path: new URL(url, 'ws://x').pathname,
			received: [],
			receivedAt: [],
			helloAt: 0,
		};
		this.connections.push(connection);
		this.sockets.add(socket);

		socket.on('close', (code) => {
			connection.closeCode = code;
			this.sockets.delete(socket);
		});
		socket.on('message', (raw) => {
			const message = JSON.parse(raw.toString()) as { op: number; d: unknown };
			connection.received.push(message);
			connection.receivedAt.push(Date.now());
			this.handle(socket, message);
		});

		if (this.rejectResumes && connection.path === '/resume') {
			socket.terminate();
			return;
		}

		if (!this.sendHello) return;
		connection.helloAt = Date.now();
		this.send(socket, { op: 10, d: { heartbeat_interval: this.heartbeatIntervalMs } });
	}

	private handle(socket: WebSocket, message: { op: number; d: unknown }): void {
		if (message.op === 1) {
			if (this.ackHeartbeats) this.send(socket, { op: 11 });
			return;
		}

		if (message.op === 2) {
			if (this.malformedIdentifyReplies > 0) {
				this.malformedIdentifyReplies--;
				if (socket.readyState === WebSocket.OPEN) socket.send('not json');
				return;
			}
			if (typeof this.onIdentify === 'object') {
				socket.close(this.onIdentify.closeWith);
				return;
			}
			this.sessions++;
			this.send(socket, {
				op: 0,
				t: 'READY',
				s: ++this.sequence,
				d: {
					session_id: `sess-${this.sessions}`,
					resume_gateway_url: `${this.baseUrl}/resume`,
				},
			});
			this.closeIfFlapping(socket);
			return;
		}

		if (message.op === 6) {
			if (this.onResume === 'invalid') {
				this.send(socket, { op: 9, d: false });
				return;
			}
			this.send(socket, { op: 0, t: 'RESUMED', s: ++this.sequence, d: {} });
			this.closeIfFlapping(socket);
		}
	}

	private closeIfFlapping(socket: WebSocket): void {
		if (this.closeAfterReady !== null) socket.close(this.closeAfterReady);
	}

	private send(socket: WebSocket, payload: object): void {
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
	}
}
