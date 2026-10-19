import { LoggerProxy } from 'n8n-workflow';

const noop = () => {};

LoggerProxy.init({ error: noop, warn: noop, info: noop, debug: noop } as never);
