import { EventEmitter } from 'node:events';
import type { LiveMessage } from '@shared/types/index.js';

/** In-process pub/sub for live updates; the WebSocket server forwards every message to the extension. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(msg: LiveMessage) {
    this.emitter.emit('live', msg);
  }

  subscribe(fn: (msg: LiveMessage) => void): () => void {
    this.emitter.on('live', fn);
    return () => this.emitter.off('live', fn);
  }
}
