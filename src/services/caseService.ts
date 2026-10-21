import { CaseModel } from '../models/Case';
import { nextSequence } from '../models/Counter';

export async function createCase(input: {
  guildId: string;
  category: string;
  action: string;
  targetId: string;
  issuerId: string;
  reason: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}) {
  const caseId = await nextSequence(`case:${input.guildId}`);
  return CaseModel.create({ ...input, caseId, evidence: input.evidence ?? [], metadata: input.metadata ?? {} });
}

export async function getCase(guildId: string, caseId: number) {
  return CaseModel.findOne({ guildId, caseId });
}
