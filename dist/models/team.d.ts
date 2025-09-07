export interface Team {
    id: string;
    name: string;
    description?: string;
    owner_id: string;
    created_by: string;
    created_at: Date;
    updated_at: Date;
    is_active: boolean;
}
export interface TeamMember {
    id: string;
    team_id: string;
    user_id: string;
    role: string;
    joined_at: Date;
    is_active: boolean;
}
export interface TeamPermission {
    id: string;
    team_id: string;
    resource_type: string;
    resource_id: string;
    permission: string;
    granted_by: string;
    granted_at: Date;
}
export interface SharedConversation {
    id: string;
    conversation_id: string;
    shared_with_id: string;
    shared_by_id: string;
    permission: string;
    shared_at: Date;
    expires_at?: Date;
    is_active: boolean;
}
//# sourceMappingURL=team.d.ts.map