"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const teamService_1 = require("../services/teamService");
const collaborationService_1 = require("../services/collaborationService");
const router = (0, express_1.Router)();
// Create team
router.post('/', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { name, description } = req.body;
        const team = await teamService_1.teamService.createTeam({
            name,
            description,
            owner_id: userId,
            created_by: userId
        });
        res.status(201).json(team);
    }
    catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Failed to create team' });
    }
});
// Get user's teams
router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const teams = await teamService_1.teamService.getUserTeams(userId);
        res.json(teams);
    }
    catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});
// Get team by ID
router.get('/:id', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user has access to this team
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json({ ...team, members });
    }
    catch (error) {
        console.error('Error fetching team:', error);
        res.status(500).json({ error: 'Failed to fetch team' });
    }
});
// Add team member
router.post('/:id/members', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user is owner or admin
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const userMember = members.find(member => member.user_id === userId);
        if (!userMember || (userMember.role !== 'owner' && userMember.role !== 'admin')) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { user_id, role } = req.body;
        const teamMember = await teamService_1.teamService.addTeamMember(req.params.id, user_id, role || 'member');
        res.status(201).json(teamMember);
    }
    catch (error) {
        console.error('Error adding team member:', error);
        res.status(500).json({ error: 'Failed to add team member' });
    }
});
// Remove team member
router.delete('/:id/members/:memberId', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user is owner or admin
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const userMember = members.find(member => member.user_id === userId);
        if (!userMember || (userMember.role !== 'owner' && userMember.role !== 'admin')) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        // Don't allow removing owner
        const memberToRemove = members.find(member => member.user_id === req.params.memberId);
        if (memberToRemove?.role === 'owner') {
            return res.status(400).json({ error: 'Cannot remove team owner' });
        }
        await teamService_1.teamService.removeTeamMember(req.params.id, req.params.memberId);
        res.status(204).send();
    }
    catch (error) {
        console.error('Error removing team member:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});
// Update member role
router.put('/:id/members/:memberId/role', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user is owner
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const userMember = members.find(member => member.user_id === userId);
        if (!userMember || userMember.role !== 'owner') {
            return res.status(403).json({ error: 'Forbidden - only owners can change roles' });
        }
        const { role } = req.body;
        const updatedMember = await teamService_1.teamService.updateMemberRole(req.params.id, req.params.memberId, role);
        res.json(updatedMember);
    }
    catch (error) {
        console.error('Error updating member role:', error);
        res.status(500).json({ error: 'Failed to update member role' });
    }
});
// Get team members
router.get('/:id/members', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user has access to this team
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json(members);
    }
    catch (error) {
        console.error('Error fetching team members:', error);
        res.status(500).json({ error: 'Failed to fetch team members' });
    }
});
// Share conversation with team
router.post('/:id/conversations/:conversationId/share', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user has access to this team
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { permission } = req.body;
        const sharedConversation = await collaborationService_1.collaborationService.shareConversation(req.params.conversationId, userId, userId, permission || 'read');
        res.status(201).json(sharedConversation);
    }
    catch (error) {
        console.error('Error sharing conversation:', error);
        res.status(500).json({ error: 'Failed to share conversation' });
    }
});
// Permission Management Routes
// Grant permission to resource
router.post('/:id/permissions', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user is owner or admin
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const userMember = members.find(member => member.user_id === userId);
        if (!userMember || (userMember.role !== 'owner' && userMember.role !== 'admin')) {
            return res.status(403).json({ error: 'Forbidden - only owners and admins can manage permissions' });
        }
        const { resource_type, resource_id, permission } = req.body;
        if (!resource_type || !resource_id || !permission) {
            return res.status(400).json({ error: 'Missing required fields: resource_type, resource_id, permission' });
        }
        const teamPermission = await teamService_1.teamService.grantPermission(req.params.id, resource_type, resource_id, permission, userId);
        res.status(201).json(teamPermission);
    }
    catch (error) {
        console.error('Error granting permission:', error);
        res.status(500).json({ error: 'Failed to grant permission' });
    }
});
// Get team permissions
router.get('/:id/permissions', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user has access to this team
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const supabase = req.supabase || await Promise.resolve().then(() => __importStar(require('../services/db'))).then(mod => mod.getSupabase());
        const { data, error } = await supabase
            .from('team_permissions')
            .select('*')
            .eq('team_id', req.params.id);
        if (error) {
            throw new Error(`Failed to fetch permissions: ${error.message}`);
        }
        res.json(data);
    }
    catch (error) {
        console.error('Error fetching permissions:', error);
        res.status(500).json({ error: 'Failed to fetch permissions' });
    }
});
// Update permission
router.put('/:id/permissions/:permissionId', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user is owner or admin
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const userMember = members.find(member => member.user_id === userId);
        if (!userMember || (userMember.role !== 'owner' && userMember.role !== 'admin')) {
            return res.status(403).json({ error: 'Forbidden - only owners and admins can manage permissions' });
        }
        const { permission } = req.body;
        if (!permission) {
            return res.status(400).json({ error: 'Missing required field: permission' });
        }
        const supabase = req.supabase || await Promise.resolve().then(() => __importStar(require('../services/db'))).then(mod => mod.getSupabase());
        const { data, error } = await supabase
            .from('team_permissions')
            .update({ permission, granted_by: userId, granted_at: new Date() })
            .eq('id', req.params.permissionId)
            .eq('team_id', req.params.id)
            .select()
            .single();
        if (error) {
            throw new Error(`Failed to update permission: ${error.message}`);
        }
        res.json(data);
    }
    catch (error) {
        console.error('Error updating permission:', error);
        res.status(500).json({ error: 'Failed to update permission' });
    }
});
// Remove permission
router.delete('/:id/permissions/:permissionId', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user is owner or admin
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const userMember = members.find(member => member.user_id === userId);
        if (!userMember || (userMember.role !== 'owner' && userMember.role !== 'admin')) {
            return res.status(403).json({ error: 'Forbidden - only owners and admins can manage permissions' });
        }
        const supabase = req.supabase || await Promise.resolve().then(() => __importStar(require('../services/db'))).then(mod => mod.getSupabase());
        const { error } = await supabase
            .from('team_permissions')
            .delete()
            .eq('id', req.params.permissionId)
            .eq('team_id', req.params.id);
        if (error) {
            throw new Error(`Failed to remove permission: ${error.message}`);
        }
        res.status(204).send();
    }
    catch (error) {
        console.error('Error removing permission:', error);
        res.status(500).json({ error: 'Failed to remove permission' });
    }
});
// Check if user has permission for resource
router.get('/:id/permissions/check', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const team = await teamService_1.teamService.getTeam(req.params.id);
        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }
        // Check if user has access to this team
        const members = await teamService_1.teamService.getTeamMembers(team.id);
        const isMember = members.some(member => member.user_id === userId);
        if (!isMember) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { resource_type, resource_id, permission } = req.query;
        if (!resource_type || !resource_id || !permission) {
            return res.status(400).json({ error: 'Missing required query parameters: resource_type, resource_id, permission' });
        }
        const hasPermission = await teamService_1.teamService.checkPermission(req.params.id, userId, resource_type, resource_id, permission);
        res.json({ hasPermission });
    }
    catch (error) {
        console.error('Error checking permission:', error);
        res.status(500).json({ error: 'Failed to check permission' });
    }
});
exports.default = router;
//# sourceMappingURL=teams.js.map