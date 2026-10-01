import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ProjectContextStore } from './types.js';

/** Persistence for Project Context — ring 3. Reads are workspace-scoped through the owner/repo rows. */
export class ProjectContextRepository implements ProjectContextStore {
  constructor(private db: Db) {}

  async getRepo(ws: string, repoId: string) {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, ws)));
    return row ?? null;
  }

  async agentExists(ws: string, id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, id), eq(t.agents.workspaceId, ws)));
    return !!row;
  }

  async skillExists(ws: string, id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.id, id), eq(t.skills.workspaceId, ws)));
    return !!row;
  }

  async agentPaths(agentId: string, repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => r.path);
  }

  async skillPaths(skillId: string, repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)))
      .orderBy(asc(t.skillContextDocs.order));
    return rows.map((r) => r.path);
  }

  /** One transaction; the owner row is locked so two concurrent PUTs serialise. */
  async replaceAgentPaths(agentId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.select({ id: t.agents.id }).from(t.agents).where(eq(t.agents.id, agentId)).for('update');
      await tx
        .delete(t.agentContextDocs)
        .where(and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)));
      if (paths.length > 0) {
        await tx
          .insert(t.agentContextDocs)
          .values(paths.map((path, order) => ({ agentId, repoId, path, order })));
      }
    });
  }

  async replaceSkillPaths(skillId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.select({ id: t.skills.id }).from(t.skills).where(eq(t.skills.id, skillId)).for('update');
      await tx
        .delete(t.skillContextDocs)
        .where(and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)));
      if (paths.length > 0) {
        await tx
          .insert(t.skillContextDocs)
          .values(paths.map((path, order) => ({ skillId, repoId, path, order })));
      }
    });
  }

  /** Skills filtered on `skills.enabled AND agent_skills.enabled`, in `agent_skills.order`. */
  async pathsForRun(agentId: string, repoId: string) {
    const agentPaths = await this.agentPaths(agentId, repoId);
    const links = await this.db
      .select({ skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order));
    const skills: { skillId: string; paths: string[] }[] = [];
    for (const l of links) {
      skills.push({ skillId: l.skillId, paths: await this.skillPaths(l.skillId, repoId) });
    }
    return { agentPaths, skills };
  }

  /** Direct `(agent, path)` pairs ∪ pairs through enabled skill links, workspace agents only. */
  async usedByPairs(ws: string, repoId: string) {
    const direct = await this.db
      .select({ agentId: t.agentContextDocs.agentId, path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(and(eq(t.agentContextDocs.repoId, repoId), eq(t.agents.workspaceId, ws)));
    const viaSkill = await this.db
      .select({ agentId: t.agentSkills.agentId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skillContextDocs.skillId, t.skills.id))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.skillContextDocs.repoId, repoId),
          eq(t.skills.enabled, true),
          eq(t.agentSkills.enabled, true),
          eq(t.agents.workspaceId, ws),
        ),
      );
    return [...direct, ...viaSkill];
  }
}
