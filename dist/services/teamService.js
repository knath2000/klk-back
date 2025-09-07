"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.teamService = exports.TeamService = void 0;
const db_1 = require("./db");
class TeamService {
    /**
     * Create a new team
     */
    async createTeam(teamData) {
        const supabase = (0, db_1.getSupabase)();
        const team = {
            id: this.generateId(),
            ...teamData,
            created_at: new Date(),
            updated_at: new Date(),
            is_active: true
        };
        const { data, error } = await supabase
            .from('teams')
            .insert([team])
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to create team: ${error.message}`);
        }
        // Add creator as owner
        await this.addTeamMember(team.id, teamData.owner_id, 'owner');
        return data;
    }
    /**
     * Get team by ID
     */
    async getTeam(id) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('teams')
            .select('*')
            .eq('id', id)
            .eq('is_active', true)
            .single();
        if (error) {
            return null;
        }
        return data;
    }
    /**
     * Get user's teams
     */
    async getUserTeams(userId) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('teams')
            .select(`
        *,
        members:team_members(user_id, role, joined_at, is_active)
      `)
            .eq('members.user_id', userId)
            .eq('members.is_active', true)
            .eq('is_active', true)
            .order('created_at', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch user teams: ${error.message}`);
        }
        return data;
    }
    /**
     * Add member to team
     */
    async addTeamMember(teamId, userId, role = 'member') {
        const supabase = (0, db_1.getSupabase)();
        const teamMember = {
            id: this.generateId(),
            team_id: teamId,
            user_id: userId,
            role,
            joined_at: new Date(),
            is_active: true
        };
        const { data, error } = await supabase
            .from('team_members')
            .insert([teamMember])
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to add team member: ${error.message}`);
        }
        return data;
    }
    /**
     * Remove member from team
     */
    async removeTeamMember(teamId, userId) {
        const supabase = (0, db_1.getSupabase)();
        const { error } = await supabase
            .from('team_members')
            .update({ is_active: false })
            .eq('team_id', teamId)
            .eq('user_id', userId);
        if (error) {
            throw new Error(`Failed to remove team member: ${error.message}`);
        }
    }
    /**
     * Update member role
     */
    async updateMemberRole(teamId, userId, role) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('team_members')
            .update({ role })
            .eq('team_id', teamId)
            .eq('user_id', userId)
            .eq('is_active', true)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update member role: ${error.message}`);
        }
        return data;
    }
    /**
     * Get team members
     */
    async getTeamMembers(teamId) {
        const supabase = (0, db_1.getSupabase)();
        const { data, error } = await supabase
            .from('team_members')
            .select('*')
            .eq('team_id', teamId)
            .eq('is_active', true);
        if (error) {
            throw new Error(`Failed to fetch team members: ${error.message}`);
        }
        return data;
    }
    /**
     * Check if user has permission for resource
     */
    async checkPermission(teamId, userId, resourceType, resourceId, requiredPermission) {
        const supabase = (0, db_1.getSupabase)();
        // Check if user is team member
        const { data: member } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', teamId)
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();
        if (!member) {
            return false;
        }
        // Owners and admins have full access
        if (member.role === 'owner' || member.role === 'admin') {
            return true;
        }
        // Check specific permissions
        const { data: permission } = await supabase
            .from('team_permissions')
            .select('permission')
            .eq('team_id', teamId)
            .eq('resource_type', resourceType)
            .eq('resource_id', resourceId)
            .single();
        if (permission) {
            return permission.permission === requiredPermission || permission.permission === 'admin';
        }
        // Default read access for members
        return requiredPermission === 'read';
    }
    /**
     * Grant permission to resource
     */
    async grantPermission(teamId, resourceType, resourceId, permission, grantedBy) {
        const supabase = (0, db_1.getSupabase)();
        const teamPermission = {
            id: this.generateId(),
            team_id: teamId,
            resource_type: resourceType,
            resource_id: resourceId,
            permission,
            granted_by: grantedBy,
            granted_at: new Date()
        };
        const { data, error } = await supabase
            .from('team_permissions')
            .upsert(teamPermission)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to grant permission: ${error.message}`);
        }
        return data;
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