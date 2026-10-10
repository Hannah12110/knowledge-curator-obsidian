import type { ClaimRecord } from "../src/types/claim";
import type {
  CachedFreshnessVerification,
  ClaimMaintenanceRecord
} from "../src/types/maintenance";
import type { KnowledgeCuratorSettings } from "../src/types/settings";
import { FreshnessVerificationService } from "../src/services/freshness-verification-service";
import { LlmService } from "../src/services/llm-service";
import type { MaintenanceService } from "../src/services/maintenance-service";
import { TavilySearchProvider } from "../src/services/search-provider";

export interface FreshnessProviderE2EInput {
  settings: KnowledgeCuratorSettings;
  claim: ClaimRecord;
  record: ClaimMaintenanceRecord;
}

export async function runFreshnessProviderE2E(
  input: FreshnessProviderE2EInput
): Promise<CachedFreshnessVerification> {
  let saved: CachedFreshnessVerification | null = null;
  const maintenance = {
    getClaim: (claimId: string) => claimId === input.claim.id ? input.claim : null,
    getRecord: (claimId: string) => claimId === input.record.claimId ? input.record : null,
    getCachedVerification: () => null,
    saveVerification: async (entry: CachedFreshnessVerification) => {
      saved = entry;
    }
  } as unknown as MaintenanceService;
  const searchProvider = new TavilySearchProvider(
    () => input.settings,
    async (url, headers, body) => {
      const response = await fetch(url, { method: "POST", headers, body });
      return { status: response.status, json: await safeJson(response) };
    }
  );
  const llmService = new LlmService(
    () => input.settings,
    async (url, headers, body) => {
      const response = await fetch(url, { method: "POST", headers, body });
      return { status: response.status, json: await safeJson(response) };
    }
  );
  const service = new FreshnessVerificationService(
    searchProvider,
    llmService,
    maintenance,
    () => input.settings.llmModel,
    () => input.settings.maxSearchResults
  );
  const result = await service.verify(input.claim.id, true);
  if (saved === null) {
    throw new Error("Freshness Provider E2E did not persist a verification result.");
  }
  return result;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}
