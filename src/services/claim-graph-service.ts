import type { ClaimRecord } from "../types/claim";
import {
  CLAIM_GRAPH_CANDIDATE_POLICY_VERSION,
  CLAIM_GRAPH_RELATION_POLICY_VERSION
} from "../types/claim-graph";
import type {
  ClaimGraphNeighbor,
  ClaimGraphSnapshot,
  ClaimGraphStats,
  ClaimGraphStore,
  KnowledgeCompressionProposal,
  KnowledgeHealthSummary
} from "../types/claim-graph";
import { ClaimStoreService } from "./claim-store-service";
import { ClaimGraphRepository } from "./claim-graph-repository";
import {
  ClaimGraphCandidateService,
  type ClaimGraphCandidateMetrics
} from "./claim-graph-candidate-service";
import { ClaimGraphRelationService, claimToGraphNode } from "./claim-graph-relation-service";
import { ClaimEvolutionService } from "./claim-evolution-service";
import { KnowledgeCompressionService } from "./knowledge-compression-service";
import { sha256Text } from "./content-hash";

export interface ClaimGraphBuildResult {
  stats: ClaimGraphStats;
  candidateMetrics: ClaimGraphCandidateMetrics;
  llmCalls: number;
  durationMs: number;
  relationMetrics: import("./claim-graph-relation-service").ClaimGraphRelationExecutionMetrics;
}

export class ClaimGraphService {
  private store: ClaimGraphStore | null = null;
  private stats: ClaimGraphStats = emptyStats("not_built");
  private listeners = new Set<(stats: ClaimGraphStats) => void>();

  constructor(
    private readonly claimStore: ClaimStoreService,
    private readonly repository: ClaimGraphRepository,
    private readonly candidates: ClaimGraphCandidateService,
    private readonly relations: ClaimGraphRelationService,
    private readonly evolution: ClaimEvolutionService,
    private readonly compression: KnowledgeCompressionService
  ) {}

  async initialize(): Promise<void> {
    const loaded = await this.repository.load();
    this.store = loaded.store;
    if (loaded.store === null) {
      this.stats = { ...emptyStats(loaded.status), message: "message" in loaded ? loaded.message : undefined };
    } else {
      this.stats = this.toStats(loaded.store, loaded.status);
    }
    this.emit();
  }

  getStats(): ClaimGraphStats {
    return {
      ...this.refreshStaleness(this.stats),
      progress: this.stats.progress === undefined ? undefined : { ...this.stats.progress }
    };
  }

  getSnapshot(): ClaimGraphSnapshot {
    return {
      stats: this.getStats(),
      nodes: this.store === null ? [] : Object.values(this.store.nodes),
      edges: this.store === null ? [] : Object.values(this.store.edges)
    };
  }

  getNeighbors(claimId: string): ClaimGraphNeighbor[] {
    if (this.store === null) return [];
    const output: ClaimGraphNeighbor[] = [];
    for (const edge of Object.values(this.store.edges)) {
      if (edge.fromClaimId === claimId) {
        const claim = this.store.nodes[edge.toClaimId];
        if (claim !== undefined) output.push({ edge, claim, direction: "outgoing" });
      } else if (edge.toClaimId === claimId) {
        const claim = this.store.nodes[edge.fromClaimId];
        if (claim !== undefined) output.push({ edge, claim, direction: "incoming" });
      }
    }
    return output.sort((left, right) => right.edge.confidence - left.edge.confidence);
  }

  getEvolution(claimId: string) {
    return this.store?.evolution.filter((event) => event.claimId === claimId) ?? [];
  }

  async getCompressionProposals(): Promise<KnowledgeCompressionProposal[]> {
    if (this.store === null) return [];
    return await this.compression.preview(Object.values(this.store.nodes), Object.values(this.store.edges));
  }

  async getHealthSummary(): Promise<KnowledgeHealthSummary> {
    const stats = this.getStats();
    return {
      claims: stats.totalClaims,
      relations: stats.totalRelations,
      conflicts: stats.conflicts,
      duplicates: stats.duplicates,
      orphanClaims: stats.orphanClaims,
      compressionProposals: (await this.getCompressionProposals()).length
    };
  }

  subscribe(listener: (stats: ClaimGraphStats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async build(): Promise<ClaimGraphBuildResult> {
    if (this.stats.status === "building") throw new Error("Claim Graph 正在构建中。");
    const claims = this.claimStore.getClaims();
    if (claims.length === 0) throw new Error("请先建立 Claim Store，再构建知识关系。 ");
    const started = Date.now();
    this.stats = { ...emptyStats("building"), totalClaims: claims.length, progress: { completed: 0, total: 0 } };
    this.emit();
    try {
      const candidateResult = await this.candidates.generate(claims);
      this.stats.progress = { completed: 0, total: candidateResult.pairs.length };
      this.emit();
      const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
      const relationResult = await this.relations.discover(
        candidateResult.pairs,
        claimsById,
        (completed, total) => {
          this.stats.progress = { completed, total };
          this.emit();
        }
      );
      const store = this.repository.empty(this.claimStore.getRevision());
      for (const claim of claims) {
        const fingerprint = await claimFingerprint(claim);
        store.nodes[claim.id] = claimToGraphNode(claim, fingerprint);
      }
      for (const edge of relationResult.edges) store.edges[edge.id] = edge;
      store.evolution = await this.evolution.derive(Object.values(store.nodes), relationResult.edges);
      const generatedAt = new Date().toISOString();
      const edges = Object.values(store.edges);
      const connected = new Set(edges.flatMap((edge) => [edge.fromClaimId, edge.toClaimId]));
      const relationStats = store.metadata.relationStats;
      for (const relation of Object.keys(relationStats) as Array<keyof typeof relationStats>) {
        relationStats[relation] = edges.filter((edge) => edge.relation === relation).length;
      }
      const orphanClaimIds = Object.keys(store.nodes).filter((id) => !connected.has(id)).sort();
      store.metadata.generatedAt = generatedAt;
      store.metadata.builtAt = generatedAt;
      store.metadata.claimStoreFingerprint = await sha256Text(this.claimStore.getRevision());
      store.metadata.nodeCount = Object.keys(store.nodes).length;
      store.metadata.edgeCount = edges.length;
      store.metadata.candidatePairs = candidateResult.pairs.length;
      store.metadata.classifiedPairs = relationResult.classifiedPairs;
      store.metadata.failedPairs = relationResult.failedPairs;
      store.metadata.buildMetadata = {
        claimCount: claims.length,
        rawScoredPairs: candidateResult.metrics.rawScoredPairs,
        candidatePairs: candidateResult.pairs.length,
        candidatePairRatio: candidateResult.metrics.candidatePairRatio,
        relationClassifications: relationResult.classifiedPairs,
        persistedEdges: edges.length,
        unrelatedCount: relationResult.metrics.unrelatedCount,
        orphanClaimIds,
        providerCalls: relationResult.metrics.providerCalls,
        successfulCalls: relationResult.metrics.successfulCalls,
        batchCount: relationResult.metrics.batchCount,
        retryCount: relationResult.metrics.retryCalls,
        retryReasons: relationResult.metrics.retryReasons,
        schemaInvalidCount: relationResult.metrics.schemaInvalidCount,
        recoveredPairs: relationResult.metrics.recoveredPairs,
        failedPairs: relationResult.failedPairs,
        candidateGenerationMs: candidateResult.metrics.durationMs,
        relationClassificationMs: relationResult.metrics.durationMs,
        totalDurationMs: Date.now() - started,
        externalSearchCalls: 0,
        autoConflictResolutions: 0,
        autoCompressionWrites: 0
      };
      await this.repository.save(store);
      this.store = store;
      this.stats = this.toStats(store, relationResult.failedPairs.length > 0 ? "partial" : "ready");
      this.emit();
      return {
        stats: this.getStats(),
        candidateMetrics: candidateResult.metrics,
        llmCalls: relationResult.llmCalls,
        durationMs: Date.now() - started,
        relationMetrics: relationResult.metrics
      };
    } catch (error: unknown) {
      this.stats = { ...emptyStats("partial"), totalClaims: claims.length, message: "知识关系构建失败，请重试。" };
      this.emit();
      throw error;
    }
  }

  private refreshStaleness(stats: ClaimGraphStats): ClaimGraphStats {
    if (this.store === null || stats.status === "building" || stats.status === "corrupt") return stats;
    const stale = this.store.metadata.claimStoreRevision !== this.claimStore.getRevision() ||
      this.store.metadata.relationPolicyVersion !== CLAIM_GRAPH_RELATION_POLICY_VERSION ||
      this.store.metadata.candidatePolicyVersion !== CLAIM_GRAPH_CANDIDATE_POLICY_VERSION;
    return stale ? { ...stats, status: "stale", message: "Claim Store 已变化，请重新构建知识关系。" } : stats;
  }

  private toStats(store: ClaimGraphStore, status: "ready" | "partial"): ClaimGraphStats {
    const edges = Object.values(store.edges);
    const connected = new Set(edges.flatMap((edge) => [edge.fromClaimId, edge.toClaimId]));
    return this.refreshStaleness({
      status,
      totalClaims: Object.keys(store.nodes).length,
      totalRelations: edges.length,
      conflicts: edges.filter((edge) => edge.relation === "contradicts").length,
      duplicates: edges.filter((edge) => edge.relation === "duplicate").length,
      orphanClaims: Object.keys(store.nodes).filter((id) => !connected.has(id)).length,
      failedPairs: store.metadata.failedPairs.length,
      lastUpdated: store.metadata.generatedAt
    });
  }

  private emit(): void {
    const stats = this.getStats();
    for (const listener of this.listeners) listener(stats);
  }
}

function emptyStats(status: ClaimGraphStats["status"]): ClaimGraphStats {
  return { status, totalClaims: 0, totalRelations: 0, conflicts: 0, duplicates: 0, orphanClaims: 0, failedPairs: 0 };
}

async function claimFingerprint(claim: ClaimRecord): Promise<string> {
  return await sha256Text(JSON.stringify({
    statement: claim.normalizedStatement,
    type: claim.type,
    topic: claim.topic ?? "",
    scope: [...(claim.scope ?? [])].sort(),
    qualifiers: [...(claim.qualifiers ?? [])].sort(),
    status: claim.status,
    provenance: claim.provenance.map((item) => ({ path: item.filePath, hash: item.fileHash })).sort((left, right) => left.path.localeCompare(right.path))
  }));
}
