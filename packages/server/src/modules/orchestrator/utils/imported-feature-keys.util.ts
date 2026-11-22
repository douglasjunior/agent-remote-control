import type { EntityManager } from 'typeorm';


/**
 * The features already in the `artifact` table, as keys for {@link featureKey}. Raw SQL keeps the orchestrator
 * independent of the artifacts entities.
 */
export async function readImportedFeatureKeys(manager: EntityManager): Promise<Set<string>> {
  const rows: { conversation_id: string; id: string }[] = await manager.query('SELECT "conversation_id", "id" FROM "artifact" WHERE "type" = \'feature\'');
  return new Set(rows.map(row => featureKey(row.conversation_id, row.id)));
}

export function featureKey(conversationId: string, artifactId: string | null | undefined): string {
  return `${conversationId}\u0000${artifactId ?? ''}`;
}
