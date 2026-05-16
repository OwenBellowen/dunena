// ── Cluster Types ──────────────────────────────────────────
// Types for the High Availability / Clustering subsystem.

export type NodeRole = "leader" | "follower" | "candidate";
export type NodeState = "alive" | "suspect" | "dead" | "left";

export interface ClusterNode {
  /** Unique node identifier (auto-generated or user-specified) */
  id: string;
  /** Hostname or IP address of the node */
  host: string;
  /** HTTP port of the node */
  port: number;
  /** Current role in the cluster */
  role: NodeRole;
  /** Current liveness state */
  state: NodeState;
  /** Election priority — higher value wins election ties */
  priority: number;
  /** Unix timestamp of last heartbeat received from this node */
  lastHeartbeat: number;
  /** The cluster term this node last participated in */
  term: number;
  /** Monotonic join timestamp */
  joinedAt: number;
  /** Additional metadata (version, features, etc.) */
  metadata: Record<string, string>;
}

export interface ClusterConfig {
  /** Enable clustering */
  enabled: boolean;
  /** Unique node ID (defaults to hostname + port hash) */
  nodeId: string;
  /** Seed node addresses for initial discovery (e.g., ["10.0.0.2:3000", "10.0.0.3:3000"]) */
  seeds: string[];
  /** Interval between heartbeat broadcasts (ms) */
  heartbeatIntervalMs: number;
  /** Time after which a node without heartbeat is marked suspect (ms) */
  suspectTimeoutMs: number;
  /** Time after which a suspect node is declared dead (ms) */
  deadTimeoutMs: number;
  /** Time to wait for election responses before declaring self leader (ms) */
  electionTimeoutMs: number;
  /** This node's election priority (higher = more preferred as leader) */
  priority: number;
  /** Whether this node should serve reads locally even as a follower */
  localReads: boolean;
  /** Port for the internal cluster gossip (defaults to HTTP port + 1000) */
  gossipPort?: number;
}

export interface ClusterState {
  /** The current election term */
  term: number;
  /** Current leader node ID (null if no leader elected) */
  leaderId: string | null;
  /** Membership roster of all known nodes */
  nodes: Map<string, ClusterNode>;
  /** This node's ID */
  selfId: string;
  /** This node's role */
  selfRole: NodeRole;
}

// ── Inter-node messages ───────────────────────────────────

export type ClusterMessageType =
  | "heartbeat"
  | "heartbeat_ack"
  | "election_start"
  | "election_vote"
  | "election_victory"
  | "join_request"
  | "join_accept"
  | "leave"
  | "state_sync"
  | "forward_write";

export interface ClusterMessage {
  type: ClusterMessageType;
  senderId: string;
  senderHost: string;
  senderPort: number;
  term: number;
  timestamp: number;
  payload?: unknown;
}

export interface HeartbeatPayload {
  role: NodeRole;
  state: NodeState;
  priority: number;
  leaderId: string | null;
  memberCount: number;
  metadata: Record<string, string>;
}

export interface ElectionVotePayload {
  candidateId: string;
  granted: boolean;
  reason?: string;
}

export interface JoinRequestPayload {
  nodeId: string;
  host: string;
  port: number;
  priority: number;
  metadata: Record<string, string>;
}

export interface JoinAcceptPayload {
  accepted: boolean;
  leaderId: string | null;
  term: number;
  members: Array<{
    id: string;
    host: string;
    port: number;
    role: NodeRole;
    state: NodeState;
    priority: number;
  }>;
}

export interface StateSyncPayload {
  /** Serialised cache state for bootstrapping new nodes */
  entries: Array<{ key: string; value: string; ttl?: number; ns?: string }>;
  cursor: number;
  done: boolean;
}

export interface ForwardWritePayload {
  operation: "set" | "delete" | "clear";
  key?: string;
  value?: string;
  ttl?: number;
  ns?: string;
}

export interface ClusterStats {
  nodeId: string;
  role: NodeRole;
  term: number;
  leaderId: string | null;
  memberCount: number;
  aliveCount: number;
  suspectCount: number;
  uptimeMs: number;
}
