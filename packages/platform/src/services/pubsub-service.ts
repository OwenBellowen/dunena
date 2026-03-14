// ── Pub/Sub Service ────────────────────────────────────────
// In-process event bus used to decouple cache mutations from
// WebSocket broadcasting and analytics recording.

import type { PubSubMessage } from "../types";

type Subscriber = (msg: PubSubMessage) => void;

export class PubSubService {
  private channels = new Map<string, Set<Subscriber>>();

  subscribe(channel: string, cb: Subscriber): () => void {
    let subs = this.channels.get(channel);
    if (!subs) {
      subs = new Set();
      this.channels.set(channel, subs);
    }
    subs.add(cb);
    return () => {
      subs!.delete(cb);
      if (subs!.size === 0) this.channels.delete(channel);
    };
  }

  publish(channel: string, event: string, data: unknown): void {
    const msg: PubSubMessage = {
      channel,
      event,
      data,
      timestamp: Date.now(),
    };

    const subs = this.channels.get(channel);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(msg);
        } catch {
          // subscriber errors are silently ignored
        }
      }
    }

    // Also notify wildcard subscribers
    const wildcardSubs = this.channels.get("*");
    if (wildcardSubs) {
      for (const cb of wildcardSubs) {
        try {
          cb(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  channelCount(): number {
    return this.channels.size;
  }

  subscriberCount(channel?: string): number {
    if (channel) {
      return this.channels.get(channel)?.size ?? 0;
    }
    let total = 0;
    for (const subs of this.channels.values()) total += subs.size;
    return total;
  }
}
