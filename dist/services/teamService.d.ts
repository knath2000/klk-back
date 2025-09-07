import { Team, TeamMember, TeamPermission } from '../models/team';
export declare class TeamService {
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
     * Generate unique ID
     */
    private generateId;
}
export declare const teamService: TeamService;
//# sourceMappingURL=teamService.d.ts.map