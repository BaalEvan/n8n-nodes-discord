export type AlertKind = 'fatal' | 'down' | 'recovered';

export interface AlertSink {
	send(kind: AlertKind, text: string): Promise<boolean>;
}
