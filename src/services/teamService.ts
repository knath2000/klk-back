import { Team, TeamMember, TeamPermission } from '../models/team';
import { PrismaClient } from '@prisma/client';

export class TeamService {
  private prisma = new PrismaClient();
  /**
   * Create a new team
   */
  async createTeam(teamData: Omit<Team, 'id' | 'created_at' | 'updated_at' | 'is_active'>): Promise<Team> {
    const now = new Date();
    const teamId = this.generateId();
    const created = await this.prisma.$transaction(async (tx) => {
      const teamRow = await tx.team.create({
        data: {
          id: teamId,
          name: teamData.name,
          description: teamData.description ?? null,
          owner_id: teamData.owner_id,
          created_by: teamData.created_by,
          created_at: now,
          updated_at: now,
          is_active: true
        }
      });
      await tx.teamMember.create({
        data: {
          id: this.generateId(),
          team_id: teamRow.id,
          user_id: teamData.owner_id,
          role: 'owner',
          joined_at: now,
          is_active: true
        }
      });
      return teamRow;
    });
    return created as unknown as Team;
  }

  /**
   * Get team by ID
   */
  async getTeam(id: string): Promise<Team | null> {
    const row = await this.prisma.team.findFirst({
      where: { id, is_active: true }
    });
    return (row as unknown as Team) ?? null;
  }

  /**
   * Get user's teams
   */
  async getUserTeams(userId: string): Promise<Team[]> {
    const teams = await this.prisma.team.findMany({
      where: {
        is_active: true,
        members: {
          some: { user_id: userId, is_active: true }
        }
      },
      orderBy: { created_at: 'desc' },
      include: {
        members: {
          select: { user_id: true, role: true, joined_at: true, is_active: true }
        }
      }
    });
    return teams as unknown as Team[];
  }

  /**
   * Add member to team
   */
  async addTeamMember(teamId: string, userId: string, role: string = 'member'): Promise<TeamMember> {
    const row = await this.prisma.teamMember.create({
      data: {
        id: this.generateId(),
        team_id: teamId,
        user_id: userId,
        role,
        joined_at: new Date(),
        is_active: true
      }
    });
    return row as unknown as TeamMember;
  }

  /**
   * Remove member from team
   */
  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.prisma.teamMember.updateMany({
      where: { team_id: teamId, user_id: userId },
      data: { is_active: false }
    });
  }

  /**
   * Update member role
   */
  async updateMemberRole(teamId: string, userId: string, role: string): Promise<TeamMember> {
    await this.prisma.teamMember.updateMany({
      where: { team_id: teamId, user_id: userId, is_active: true },
      data: { role }
    });
    const updated = await this.prisma.teamMember.findFirst({
      where: { team_id: teamId, user_id: userId, is_active: true }
    });
    if (!updated) throw new Error('Member not found after role update');
    return updated as unknown as TeamMember;
  }

  /**
   * Get team members
   */
  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    const rows = await this.prisma.teamMember.findMany({
      where: { team_id: teamId, is_active: true }
    });
    return rows as unknown as TeamMember[];
  }

  /**
   * Check if user has permission for resource
   */
  async checkPermission(teamId: string, userId: string, resourceType: string, resourceId: string, requiredPermission: string): Promise<boolean> {
    // Check membership
    const member = await this.prisma.teamMember.findFirst({
      where: { team_id: teamId, user_id: userId, is_active: true },
      select: { role: true }
    });
    if (!member) return false;
    if (member.role === 'owner' || member.role === 'admin') return true;
    // Check specific permission
    const perm = await this.prisma.teamPermission.findUnique({
      where: {
        team_id_resource_type_resource_id: {
          team_id: teamId,
          resource_type: resourceType,
          resource_id: resourceId
        }
      },
      select: { permission: true }
    });
    if (perm) {
      return perm.permission === requiredPermission || perm.permission === 'admin';
    }
    return requiredPermission === 'read';
  }

  /**
   * Grant permission to resource
   */
  async grantPermission(teamId: string, resourceType: string, resourceId: string, permission: string, grantedBy: string): Promise<TeamPermission> {
    const now = new Date();
    const row = await this.prisma.teamPermission.upsert({
      where: {
        team_id_resource_type_resource_id: {
          team_id: teamId,
          resource_type: resourceType,
          resource_id: resourceId
        }
      },
      update: { permission, granted_by: grantedBy, granted_at: now },
      create: {
        team_id: teamId,
        resource_type: resourceType,
        resource_id: resourceId,
        permission,
        granted_by: grantedBy,
        granted_at: now
      }
    });
    return row as unknown as TeamPermission;
  }

  /**
   * List permissions for a team
   */
  async getTeamPermissions(teamId: string): Promise<TeamPermission[]> {
    const rows = await this.prisma.teamPermission.findMany({
      where: { team_id: teamId }
    });
    return rows as unknown as TeamPermission[];
  }

  /**
   * Update a specific permission by id (ensuring it belongs to team)
   */
  async updatePermission(teamId: string, permissionId: string, permission: string, grantedBy: string): Promise<TeamPermission> {
    const existing = await this.prisma.teamPermission.findUnique({ where: { id: permissionId } });
    if (!existing || existing.team_id !== teamId) {
      throw new Error('Permission not found for team');
    }
    const updated = await this.prisma.teamPermission.update({
      where: { id: permissionId },
      data: { permission, granted_by: grantedBy, granted_at: new Date() }
    });
    return updated as unknown as TeamPermission;
  }

  /**
   * Remove a permission by id (ensuring it belongs to team)
   */
  async removePermission(teamId: string, permissionId: string): Promise<void> {
    const existing = await this.prisma.teamPermission.findUnique({ where: { id: permissionId } });
    if (!existing || existing.team_id !== teamId) {
      throw new Error('Permission not found for team');
    }
    await this.prisma.teamPermission.delete({ where: { id: permissionId } });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// Export singleton instance
export const teamService = new TeamService();