"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teamService = exports.TeamService = void 0;
const client_1 = require("@prisma/client");
class TeamService {
    constructor() {
        this.prisma = new client_1.PrismaClient();
    }
    /**
     * Create a new team
     */
    async createTeam(teamData) {
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
        return created;
    }
    /**
     * Get team by ID
     */
    async getTeam(id) {
        const row = await this.prisma.team.findFirst({
            where: { id, is_active: true }
        });
        return row ?? null;
    }
    /**
     * Get user's teams
     */
    async getUserTeams(userId) {
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
        return teams;
    }
    /**
     * Add member to team
     */
    async addTeamMember(teamId, userId, role = 'member') {
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
        return row;
    }
    /**
     * Remove member from team
     */
    async removeTeamMember(teamId, userId) {
        await this.prisma.teamMember.updateMany({
            where: { team_id: teamId, user_id: userId },
            data: { is_active: false }
        });
    }
    /**
     * Update member role
     */
    async updateMemberRole(teamId, userId, role) {
        await this.prisma.teamMember.updateMany({
            where: { team_id: teamId, user_id: userId, is_active: true },
            data: { role }
        });
        const updated = await this.prisma.teamMember.findFirst({
            where: { team_id: teamId, user_id: userId, is_active: true }
        });
        if (!updated)
            throw new Error('Member not found after role update');
        return updated;
    }
    /**
     * Get team members
     */
    async getTeamMembers(teamId) {
        const rows = await this.prisma.teamMember.findMany({
            where: { team_id: teamId, is_active: true }
        });
        return rows;
    }
    /**
     * Check if user has permission for resource
     */
    async checkPermission(teamId, userId, resourceType, resourceId, requiredPermission) {
        // Check membership
        const member = await this.prisma.teamMember.findFirst({
            where: { team_id: teamId, user_id: userId, is_active: true },
            select: { role: true }
        });
        if (!member)
            return false;
        if (member.role === 'owner' || member.role === 'admin')
            return true;
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
    async grantPermission(teamId, resourceType, resourceId, permission, grantedBy) {
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
        return row;
    }
    /**
     * List permissions for a team
     */
    async getTeamPermissions(teamId) {
        const rows = await this.prisma.teamPermission.findMany({
            where: { team_id: teamId }
        });
        return rows;
    }
    /**
     * Update a specific permission by id (ensuring it belongs to team)
     */
    async updatePermission(teamId, permissionId, permission, grantedBy) {
        const existing = await this.prisma.teamPermission.findUnique({ where: { id: permissionId } });
        if (!existing || existing.team_id !== teamId) {
            throw new Error('Permission not found for team');
        }
        const updated = await this.prisma.teamPermission.update({
            where: { id: permissionId },
            data: { permission, granted_by: grantedBy, granted_at: new Date() }
        });
        return updated;
    }
    /**
     * Remove a permission by id (ensuring it belongs to team)
     */
    async removePermission(teamId, permissionId) {
        const existing = await this.prisma.teamPermission.findUnique({ where: { id: permissionId } });
        if (!existing || existing.team_id !== teamId) {
            throw new Error('Permission not found for team');
        }
        await this.prisma.teamPermission.delete({ where: { id: permissionId } });
    }
    /**
     * Generate unique ID
     */
    generateId() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
}
exports.TeamService = TeamService;
// Export singleton instance
exports.teamService = new TeamService();
//# sourceMappingURL=teamService.js.map