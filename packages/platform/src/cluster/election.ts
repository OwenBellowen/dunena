// ── Leader Election ────────────────────────────────────────
// Implements a modified Bully algorithm for leader election.
// When a leader failure is detected, the highest-priority alive
// node initiates an election and becomes leader if no higher-
// priority node contests within the election timeout.

import type {
  ClusterMessage,
  ElectionVotePayload,
  NodeRole,
} from "./types";
import { MembershipService } from "./membership";
import { logger } from "../utils/logger";

const log = logger.child("cluster:election");

type ElectionEvent =
  | { type: "elected_leader"; term: number }
  | { type: "became_follower"; leaderId: string; term: number }
  | { type: "election_started"; term: number; candidateId: string };

type ElectionListener = (event: ElectionEvent) => void;

export class ElectionService {
  private membership: MembershipService;
  private electionTimeoutMs: number;
  private electionTimer: Timer | null = null;
  private currentTerm: number = 0;
  private votedFor: string | null = null;
  private listeners: Set<ElectionListener> = new Set();
  private electionInProgress: boolean = false;

  constructor(membership: MembershipService, electionTimeoutMs: number) {
    this.membership = membership;
    this.electionTimeoutMs = electionTimeoutMs;

    // Listen for membership changes that might trigger elections
    this.membership.onMembershipChange((event) => {
      if (event.type === "node_dead" && event.node.role === "leader") {
        log.warn("Leader node died — triggering election", { deadLeader: event.node.id });
        this.startElection();
      }
    });
  }

  /**
   * Register a listener for election events.
   */
  onElectionEvent(listener: ElectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get the current election term.
   */
  getTerm(): number {
    return this.currentTerm;
  }

  /**
   * Initiate a leader election.
   */
  startElection(): void {
    if (this.electionInProgress) return;
    this.electionInProgress = true;

    const self = this.membership.getSelf();
    this.currentTerm++;
    this.votedFor = self.id;
    self.role = "candidate";
    this.membership.setSelfRole("candidate");
    this.membership.setTerm(this.currentTerm);

    log.info("Starting election", { term: this.currentTerm, candidateId: self.id });
    this.emit({ type: "election_started", term: this.currentTerm, candidateId: self.id });

    // Send election messages to all nodes with higher priority
    const aliveNodes = this.membership.getAliveNodes().filter(n => n.id !== self.id);
    const higherPriorityNodes = aliveNodes.filter(n => n.priority > self.priority);

    if (higherPriorityNodes.length === 0) {
      // No higher-priority nodes — we can claim leadership after timeout
      this.scheduleVictoryDeclaration();
    } else {
      // Ask higher-priority nodes to take over
      this.requestElection(higherPriorityNodes);
    }
  }

  /**
   * Handle an incoming election start message.
   */
  handleElectionStart(msg: ClusterMessage): void {
    const self = this.membership.getSelf();

    // If we have higher priority, start our own election
    if (self.priority > (msg.payload as any)?.priority) {
      log.info("Contesting election — we have higher priority", {
        ourPriority: self.priority,
        theirPriority: (msg.payload as any)?.priority,
      });
      this.startElection();
    }

    // If the message term is higher, update our term
    if (msg.term > this.currentTerm) {
      this.currentTerm = msg.term;
      this.membership.setTerm(this.currentTerm);
    }
  }

  /**
   * Handle an incoming election vote / response.
   */
  handleElectionVote(msg: ClusterMessage): void {
    const payload = msg.payload as ElectionVotePayload;

    if (!payload.granted) {
      // A higher-priority node rejected — abort our election
      log.info("Election contested by higher-priority node", { from: msg.senderId });
      this.cancelElection();
    }
  }

  /**
   * Handle a victory declaration from another node.
   */
  handleVictory(msg: ClusterMessage): void {
    if (msg.term >= this.currentTerm) {
      this.currentTerm = msg.term;
      this.votedFor = null;
      this.electionInProgress = false;
      this.cancelElectionTimer();

      const self = this.membership.getSelf();
      self.role = "follower";
      this.membership.setSelfRole("follower");
      this.membership.setTerm(this.currentTerm);

      // Update the winner node's role
      const winnerNode = this.membership.getNodes().get(msg.senderId);
      if (winnerNode) {
        winnerNode.role = "leader";
      }

      log.info("Accepted new leader", { leaderId: msg.senderId, term: this.currentTerm });
      this.emit({ type: "became_follower", leaderId: msg.senderId, term: this.currentTerm });
    }
  }

  /**
   * Check whether the cluster needs a new leader and trigger election if needed.
   * Called periodically or when the cluster first forms.
   */
  checkLeaderHealth(): void {
    const nodes = this.membership.getAliveNodes();
    const hasLeader = nodes.some(n => n.role === "leader");

    if (!hasLeader && !this.electionInProgress) {
      log.info("No leader detected — initiating election");
      this.startElection();
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private async requestElection(higherNodes: import("./types").ClusterNode[]): Promise<void> {
    const self = this.membership.getSelf();

    const msg: ClusterMessage = {
      type: "election_start",
      senderId: self.id,
      senderHost: self.host,
      senderPort: self.port,
      term: this.currentTerm,
      timestamp: Date.now(),
      payload: { priority: self.priority },
    };

    let anyResponded = false;

    const promises = higherNodes.map(async (node) => {
      try {
        const res = await this.membership.sendMessage(node, msg);
        if (res.ok) {
          anyResponded = true;
        }
      } catch {
        // Node didn't respond — it may be down
      }
    });

    // Wait for responses with a timeout
    await Promise.race([
      Promise.allSettled(promises),
      new Promise<void>(resolve => setTimeout(resolve, this.electionTimeoutMs)),
    ]);

    // If no higher-priority node responded, declare ourselves winner
    if (!anyResponded && this.electionInProgress) {
      this.declareVictory();
    }
  }

  private scheduleVictoryDeclaration(): void {
    this.electionTimer = setTimeout(() => {
      if (this.electionInProgress) {
        this.declareVictory();
      }
    }, this.electionTimeoutMs);
  }

  private declareVictory(): void {
    const self = this.membership.getSelf();
    self.role = "leader";
    this.membership.setSelfRole("leader");
    this.electionInProgress = false;

    log.info("🏆 Elected as leader", { term: this.currentTerm, nodeId: self.id });
    this.emit({ type: "elected_leader", term: this.currentTerm });

    // Broadcast victory to all alive nodes
    const victoryMsg: ClusterMessage = {
      type: "election_victory",
      senderId: self.id,
      senderHost: self.host,
      senderPort: self.port,
      term: this.currentTerm,
      timestamp: Date.now(),
    };

    for (const node of this.membership.getAliveNodes()) {
      if (node.id === self.id) continue;
      this.membership.sendMessage(node, victoryMsg).catch(() => {});
    }
  }

  private cancelElection(): void {
    this.electionInProgress = false;
    this.cancelElectionTimer();

    const self = this.membership.getSelf();
    if (self.role === "candidate") {
      self.role = "follower";
      this.membership.setSelfRole("follower");
    }
  }

  private cancelElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  private emit(event: ElectionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors are silently ignored
      }
    }
  }
}
