// ── Cluster Service ────────────────────────────────────────
// Top-level orchestrator that wires together membership,
// leader election, replication, and HTTP endpoints for
// inter-node communication.

import type {
  ClusterConfig,
  ClusterMessage,
  ClusterStats,
  ForwardWritePayload,
} from "./types";
import { MembershipService } from "./membership";
import { ElectionService } from "./election";
import { ReplicationService } from "../services/replication-service";
import { CacheService } from "../services/cache-service";
import { PubSubService } from "../services/pubsub-service";
import { logger } from "../utils/logger";

const log = logger.child("cluster");

export class ClusterService {
  private config: ClusterConfig;
  private membership: MembershipService;
  private election: ElectionService;
  private replication: ReplicationService;
  private cache: CacheService;
  private pubsub: PubSubService;
  private leaderCheckTimer: Timer | null = null;
  private startedAt: number = Date.now();

  constructor(
    config: ClusterConfig,
    cache: CacheService,
    pubsub: PubSubService,
    replication: ReplicationService,
  ) {
    this.config = config;
    this.cache = cache;
    this.pubsub = pubsub;
    this.replication = replication;

    // Initialise subsystems
    this.membership = new MembershipService(config);
    this.election = new ElectionService(this.membership, config.electionTimeoutMs);

    // Wire membership changes → replication reconfiguration
    this.membership.onMembershipChange((event) => {
      switch (event.type) {
        case "node_joined":
          this.onNodeJoined(event.node);
          break;
        case "node_dead":
        case "node_left":
          this.onNodeRemoved(event.node);
          break;
      }
    });

    // Wire election results → role change behaviour
    this.election.onElectionEvent((event) => {
      switch (event.type) {
        case "elected_leader":
          this.onBecameLeader();
          break;
        case "became_follower":
          this.onBecameFollower(event.leaderId);
          break;
      }
    });
  }

  /**
   * Start the cluster service.
   */
  start(host: string, port: number): void {
    if (!this.config.enabled) return;

    this.startedAt = Date.now();
    this.membership.start(host, port);

    // Periodically check if we need a leader
    this.leaderCheckTimer = setInterval(() => {
      this.election.checkLeaderHealth();
    }, this.config.electionTimeoutMs * 2);
    this.leaderCheckTimer.unref();

    log.info("Cluster service started", {
      nodeId: this.config.nodeId,
      seeds: this.config.seeds.length,
    });
  }

  /**
   * Stop the cluster service gracefully.
   */
  stop(): void {
    if (this.leaderCheckTimer) clearInterval(this.leaderCheckTimer);
    this.membership.stop();
    log.info("Cluster service stopped");
  }

  /**
   * Whether clustering is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Whether this node is the current leader.
   */
  isLeader(): boolean {
    return this.membership.getSelf().role === "leader";
  }

  /**
   * Get the current leader node ID.
   */
  getLeaderId(): string | null {
    for (const node of this.membership.getAliveNodes()) {
      if (node.role === "leader") return node.id;
    }
    return null;
  }

  /**
   * Get cluster stats.
   */
  getStats(): ClusterStats {
    const self = this.membership.getSelf();
    const counts = this.membership.getNodeCounts();
    return {
      nodeId: self.id,
      role: self.role,
      term: this.election.getTerm(),
      leaderId: this.getLeaderId(),
      memberCount: this.membership.getNodes().size,
      aliveCount: counts.alive,
      suspectCount: counts.suspect,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  /**
   * Get full membership list (for API exposure).
   */
  getMembers() {
    return Array.from(this.membership.getNodes().values()).map(n => ({
      id: n.id,
      host: n.host,
      port: n.port,
      role: n.role,
      state: n.state,
      priority: n.priority,
      lastHeartbeat: n.lastHeartbeat,
      term: n.term,
    }));
  }

  // ── Inbound message dispatch ────────────────────────────

  /**
   * Handle an inbound cluster message from the /_cluster/message endpoint.
   */
  handleMessage(msg: ClusterMessage): unknown {
    switch (msg.type) {
      case "heartbeat":
        this.membership.handleHeartbeat(msg);
        return { ok: true };

      case "election_start":
        this.election.handleElectionStart(msg);
        return { ok: true };

      case "election_vote":
        this.election.handleElectionVote(msg);
        return { ok: true };

      case "election_victory":
        this.election.handleVictory(msg);
        return { ok: true };

      case "join_request":
        return this.membership.handleJoinRequest(msg);

      case "leave":
        this.membership.handleLeave(msg);
        return { ok: true };

      case "forward_write":
        return this.handleForwardedWrite(msg);

      default:
        log.warn("Unknown cluster message type", { type: msg.type });
        return { ok: false, error: "Unknown message type" };
    }
  }

  /**
   * Forward a write operation to the leader.
   * Called by followers when they receive write requests with localReads enabled.
   */
  async forwardWrite(op: ForwardWritePayload): Promise<boolean> {
    const leaderId = this.getLeaderId();
    if (!leaderId) {
      log.warn("Cannot forward write — no leader available");
      return false;
    }

    const leaderNode = this.membership.getNodes().get(leaderId);
    if (!leaderNode) return false;

    const msg: ClusterMessage = {
      type: "forward_write",
      senderId: this.membership.getSelf().id,
      senderHost: this.membership.getSelf().host,
      senderPort: this.membership.getSelf().port,
      term: this.election.getTerm(),
      timestamp: Date.now(),
      payload: op,
    };

    try {
      const res = await this.membership.sendMessage(leaderNode, msg);
      return res.ok;
    } catch (err) {
      log.error("Failed to forward write to leader", {
        leader: leaderId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // ── Internal event handlers ───────────────────────────────

  private onNodeJoined(node: import("./types").ClusterNode): void {
    // Auto-configure replication for the new node
    this.replication.addReplica({
      id: node.id,
      url: `http://${node.host}:${node.port}`,
      enabled: true,
      syncMode: "async",
    });

    this.pubsub.publish("cluster", "node_joined", {
      nodeId: node.id,
      host: node.host,
      port: node.port,
    });

    log.info("Auto-configured replication for new node", { nodeId: node.id });
  }

  private onNodeRemoved(node: import("./types").ClusterNode): void {
    this.replication.removeReplica(node.id);

    this.pubsub.publish("cluster", "node_removed", {
      nodeId: node.id,
      reason: node.state,
    });

    log.info("Removed replication for departed node", { nodeId: node.id, state: node.state });
  }

  private onBecameLeader(): void {
    // Enable replication — leader pushes writes to all followers
    this.replication.setEnabled(true);

    // Subscribe to cache mutations for auto-replication
    this.pubsub.publish("cluster", "leader_elected", {
      nodeId: this.membership.getSelf().id,
      term: this.election.getTerm(),
    });

    log.info("This node is now the cluster leader — replication enabled");
  }

  private onBecameFollower(leaderId: string): void {
    // Disable outbound replication — only the leader replicates
    this.replication.setEnabled(false);

    this.pubsub.publish("cluster", "new_leader", {
      leaderId,
      term: this.election.getTerm(),
    });

    log.info("Following new leader", { leaderId });
  }

  /**
   * Handle a write forwarded from a follower.
   */
  private handleForwardedWrite(msg: ClusterMessage): { ok: boolean; error?: string } {
    if (!this.isLeader()) {
      return { ok: false, error: "Not the leader" };
    }

    const op = msg.payload as ForwardWritePayload;

    try {
      switch (op.operation) {
        case "set":
          if (op.key && op.value) {
            this.cache.set(op.key, op.value, op.ttl, op.ns);
          }
          break;
        case "delete":
          if (op.key) {
            this.cache.delete(op.key, op.ns);
          }
          break;
        case "clear":
          this.cache.clear();
          break;
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
