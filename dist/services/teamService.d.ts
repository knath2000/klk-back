import { Team, TeamMember, TeamPermission } from '../models/team';
export declare class TeamService {
    private prisma;
    /**
     * Create a new team
     */
    createTeam(teamData: Omit<Team, 'id' | 'created_at' | 'updated_at' | 'is_active'>): Promise<Team>;
    /**
     * Get team by ID
     */
    getTeam(id: string): Promise<Team | null>;
    /**
     * Get user's teams
     */
    getUserTeams(userId: string): Promise<Team[]>;
    /**
     * Add member to team
     */
    addTeamMember(teamId: string, userId: string, role?: string): Promise<TeamMember>;
    /**
     * Remove member from team
     */
    removeTeamMember(teamId: string, userId: string): Promise<void>;
    /**
     * Update member role
     */
    updateMemberRole(teamId: string, userId: string, role: string): Promise<TeamMember>;
    /**
     * Get team members
     */
    getTeamMembers(teamId: string): Promise<TeamMember[]>;
    /**
     * Check if user has permission for resource
     */
    checkPermission(teamId: string, userId: string, resourceType: string, resourceId: string, requiredPermission: string): Promise<boolean>;
    /**
     * Grant permission to resource
     */
    grantPermission(teamId: string, resourceType: string, resourceId: string, permission: string, grantedBy: string): Promise<TeamPermission>;
    /**
     * List permissions for a team
     */
    getTeamPermissions(teamId: string): Promise<TeamPermission[]>;
    /**
     * Update a specific permission by id (ensuring it belongs to team)
     */
    updatePermission(teamId: string, permissionId: string, permission: string, grantedBy: string): Promise<TeamPermission>;
    /**
     * Remove a permission by id (ensuring it belongs to team)
     */
    removePermission(teamId: string, permissionId: string): Promise<void>;
    /**
     * Generate unique ID
     */
    private generateId;
}
export declare const teamService: TeamService;
//# sourceMappingURL=teamService.d.ts.map