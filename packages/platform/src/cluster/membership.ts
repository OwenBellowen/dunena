// ── Membership Service ─────────────────────────────────────
// Gossip-based node discovery and failure detection.
// Each node periodically broadcasts heartbeats to all known peers.
// Nodes that miss heartbeats transition: alive → suspect → dead.

import type {
  ClusterConfig,
  ClusterNode,
  ClusterMessage,
  HeartbeatPayload,
  JoinRequestPayload,
  JoinAcceptPayload,
  NodeState,
} from "./types";
import { logger } from "../utils/logger";

const log = logger.child("cluster:membership");

type MembershipEvent =
  | { type: "node_joined"; node: ClusterNode }
  | { type: "node_suspect"; node: ClusterNode }
  | { type: "node_dead"; node: ClusterNode }
  | { type: "node_recovered"; node: ClusterNode }
  | { type: "node_left"; node: ClusterNode };

type MembershipListener = (event: MembershipEvent) => void;

export class MembershipService {
  private nodes: Map<string, ClusterNode> = new Map();
  private config: ClusterConfig;
  private selfNode: ClusterNode;
  private heartbeatTimer: Timer | null = null;
  private failureDetectorTimer: Timer | null = null;
  private listeners: Set<MembershipListener> = new Set();

  constructor(config: ClusterConfig) {
    this.config = config;

    // Build our own node representation
    this.selfNode = {
      id: config.nodeId,
      host: "0.0.0.0", // Will be overridden when server starts
      port: 0,         // Will be overridden when server starts
      role: "follower",
      state: "alive",
      priority: config.priority,
      lastHeartbeat: Date.now(),
      term: 0,
      joinedAt: Date.now(),
      metadata: {
        version: "0.3.1",
        runtime: "bun",
      },
    };

    this.nodes.set(config.nodeId, this.selfNode);
  }

  /**
   * Start the membership protocol — begin heartbeating and failure detection.
   */
  start(host: string, port: number): void {
    this.selfNode.host = host;
    this.selfNode.port = port;

    log.info("Membership service starting", {
      nodeId: this.config.nodeId,
      address: `${host}:${port}`,
      seeds: this.config.seeds,
    });

    // Contact seed nodes to join the cluster
    this.contactSeeds();

    // Start periodic heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
    }, this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    // Start failure detector
    this.failureDetectorTimer = setInterval(() => {
      this.detectFailures();
    }, this.config.heartbeatIntervalMs * 2);
    this.failureDetectorTimer.unref();
  }

  /**
   * Stop the membership protocol — clear timers and broadcast leave.
   */
  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.failureDetectorTimer) clearInterval(this.failureDetectorTimer);
    this.broadcastLeave();
    log.info("Membership service stopped");
  }

  /**
   * Register a listener for membership change events.
   */
  onMembershipChange(listener: MembershipListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get self node reference.
   */
  getSelf(): ClusterNode {
    return this.selfNode;
  }

  /**
   * Get all known nodes.
   */
  getNodes(): Map<string, ClusterNode> {
    return new Map(this.nodes);
  }

  /**
   * Get alive nodes only.
   */
  getAliveNodes(): ClusterNode[] {
    return Array.from(this.nodes.values()).filter(n => n.state === "alive");
  }

  /**
   * Get the count of nodes by state.
   */
  getNodeCounts(): { alive: number; suspect: number; dead: number } {
    let alive = 0, suspect = 0, dead = 0;
    for (const n of this.nodes.values()) {
      if (n.state === "alive") alive++;
      else if (n.state === "suspect") suspect++;
      else if (n.state === "dead") dead++;
    }
    return { alive, suspect, dead };
  }

  /**
   * Update self role (called by election service).
   */
  setSelfRole(role: ClusterNode["role"]): void {
    this.selfNode.role = role;
  }

  /**
   * Update the term (called by election service).
   */
  setTerm(term: number): void {
    this.selfNode.term = term;
  }

  // ── Inbound message handlers ──────────────────────────────

  /**
   * Process an inbound heartbeat from another node.
   */
  handleHeartbeat(msg: ClusterMessage): void {
    const payload = msg.payload as HeartbeatPayload;
    const existing = this.nodes.get(msg.senderId);

    if (existing) {
      // Update existing node
      existing.lastHeartbeat = Date.now();
      existing.role = payload.role;
      existing.priority = payload.priority;
      existing.metadata = payload.metadata;

      // Recover suspect nodes
      if (existing.state === "suspect") {
        existing.state = "alive";
        this.emit({ type: "node_recovered", node: existing });
        log.info("Node recovered", { id: msg.senderId });
      }
    } else {
      // New node discovered via heartbeat
      const newNode: ClusterNode = {
        id: msg.senderId,
        host: msg.senderHost,
        port: msg.senderPort,
        role: payload.role,
        state: "alive",
        priority: payload.priority,
        lastHeartbeat: Date.now(),
        term: msg.term,
        joinedAt: Date.now(),
        metadata: payload.metadata,
      };
      this.nodes.set(msg.senderId, newNode);
      this.emit({ type: "node_joined", node: newNode });
      log.info("Node discovered via heartbeat", { id: msg.senderId, address: `${msg.senderHost}:${msg.senderPort}` });
    }
  }

  /**
   * Process a join request from a new node wanting to join the cluster.
   */
  handleJoinRequest(msg: ClusterMessage): JoinAcceptPayload {
    const payload = msg.payload as JoinRequestPayload;

    const newNode: ClusterNode = {
      id: payload.nodeId,
      host: payload.host,
      port: payload.port,
      role: "follower",
      state: "alive",
      priority: payload.priority,
      lastHeartbeat: Date.now(),
      term: this.selfNode.term,
      joinedAt: Date.now(),
      metadata: payload.metadata,
    };

    this.nodes.set(payload.nodeId, newNode);
    this.emit({ type: "node_joined", node: newNode });
    log.info("Node joined cluster", { id: payload.nodeId, address: `${payload.host}:${payload.port}` });

    // Return current membership roster
    const members = Array.from(this.nodes.values()).map(n => ({
      id: n.id,
      host: n.host,
      port: n.port,
      role: n.role,
      state: n.state,
      priority: n.priority,
    }));

    // Find leader
    const leader = Array.from(this.nodes.values()).find(n => n.role === "leader");

    return {
      accepted: true,
      leaderId: leader?.id ?? null,
      term: this.selfNode.term,
      members,
    };
  }

  /**
   * Process a leave notification.
   */
  handleLeave(msg: ClusterMessage): void {
    const node = this.nodes.get(msg.senderId);
    if (node) {
      node.state = "left";
      this.nodes.delete(msg.senderId);
      this.emit({ type: "node_left", node });
      log.info("Node left cluster", { id: msg.senderId });
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private async contactSeeds(): Promise<void> {
    for (const seed of this.config.seeds) {
      const [host, portStr] = seed.split(":");
      const port = parseInt(portStr, 10);
      if (host === this.selfNode.host && port === this.selfNode.port) continue; // Skip self

      const joinMsg: ClusterMessage = {
        type: "join_request",
        senderId: this.config.nodeId,
        senderHost: this.selfNode.host,
        senderPort: this.selfNode.port,
        term: this.selfNode.term,
        timestamp: Date.now(),
        payload: {
          nodeId: this.config.nodeId,
          host: this.selfNode.host,
          port: this.selfNode.port,
          priority: this.config.priority,
          metadata: this.selfNode.metadata,
        } satisfies JoinRequestPayload,
      };

      try {
        const res = await fetch(`http://${host}:${port}/_cluster/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(joinMsg),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const accept = (await res.json()) as JoinAcceptPayload;
          if (accept.accepted) {
            // Merge membership roster
            for (const member of accept.members) {
              if (member.id === this.config.nodeId) continue;
              if (!this.nodes.has(member.id)) {
                const node: ClusterNode = {
                  id: member.id,
                  host: member.host,
                  port: member.port,
                  role: member.role,
                  state: member.state as NodeState,
                  priority: member.priority,
                  lastHeartbeat: Date.now(),
                  term: accept.term,
                  joinedAt: Date.now(),
                  metadata: {},
                };
                this.nodes.set(member.id, node);
              }
            }

            if (accept.leaderId) {
              this.selfNode.term = accept.term;
            }

            log.info("Joined cluster via seed", {
              seed,
              members: accept.members.length,
              leader: accept.leaderId,
            });
            return; // Successfully joined, stop trying other seeds
          }
        }
      } catch (err) {
        log.debug("Failed to contact seed", {
          seed,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // If no seeds responded, we might be the first node
    if (this.config.seeds.length > 0) {
      log.warn("No seed nodes responded — may be the first node in the cluster");
    }
  }

  private broadcastHeartbeat(): void {
    const payload: HeartbeatPayload = {
      role: this.selfNode.role,
      state: this.selfNode.state,
      priority: this.selfNode.priority,
      leaderId: this.getLeaderId(),
      memberCount: this.nodes.size,
      metadata: this.selfNode.metadata,
    };

    const msg: ClusterMessage = {
      type: "heartbeat",
      senderId: this.config.nodeId,
      senderHost: this.selfNode.host,
      senderPort: this.selfNode.port,
      term: this.selfNode.term,
      timestamp: Date.now(),
      payload,
    };

    for (const node of this.nodes.values()) {
      if (node.id === this.config.nodeId) continue;
      if (node.state === "dead" || node.state === "left") continue;

      this.sendMessage(node, msg).catch(() => {
        // Heartbeat failure is handled by the failure detector
      });
    }

    // Update own heartbeat timestamp
    this.selfNode.lastHeartbeat = Date.now();
  }

  private broadcastLeave(): void {
    const msg: ClusterMessage = {
      type: "leave",
      senderId: this.config.nodeId,
      senderHost: this.selfNode.host,
      senderPort: this.selfNode.port,
      term: this.selfNode.term,
      timestamp: Date.now(),
    };

    for (const node of this.nodes.values()) {
      if (node.id === this.config.nodeId) continue;
      if (node.state === "dead" || node.state === "left") continue;
      this.sendMessage(node, msg).catch(() => {}); // Best effort
    }
  }

  private detectFailures(): void {
    const now = Date.now();

    for (const node of this.nodes.values()) {
      if (node.id === this.config.nodeId) continue; // Skip self
      if (node.state === "dead" || node.state === "left") continue;

      const elapsed = now - node.lastHeartbeat;

      if (node.state === "alive" && elapsed > this.config.suspectTimeoutMs) {
        node.state = "suspect";
        this.emit({ type: "node_suspect", node });
        log.warn("Node suspected", { id: node.id, elapsedMs: elapsed });
      } else if (node.state === "suspect" && elapsed > this.config.deadTimeoutMs) {
        node.state = "dead";
        this.emit({ type: "node_dead", node });
        log.error("Node declared dead", { id: node.id, elapsedMs: elapsed });
      }
    }
  }

  /**
   * Send a message to another node via HTTP.
   */
  async sendMessage(target: ClusterNode, msg: ClusterMessage): Promise<Response> {
    return fetch(`http://${target.host}:${target.port}/_cluster/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(3000),
    });
  }

  private getLeaderId(): string | null {
    for (const node of this.nodes.values()) {
      if (node.role === "leader" && node.state === "alive") return node.id;
    }
    return null;
  }

  private emit(event: MembershipEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors are silently ignored
      }
    }
  }
}
