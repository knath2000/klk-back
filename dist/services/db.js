"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSupabase = initSupabase;
exports.getSupabase = getSupabase;
exports.saveMessage = saveMessage;
exports.fetchRecentMessages = fetchRecentMessages;
exports.savePersona = savePersona;
exports.fetchPersonas = fetchPersonas;
exports.createUser = createUser;
exports.findUserByEmail = findUserByEmail;
exports.findUserById = findUserById;
exports.createSession = createSession;
exports.findSessionByToken = findSessionByToken;
exports.deleteExpiredSessions = deleteExpiredSessions;
exports.getUserSubscription = getUserSubscription;
exports.upsertUserSubscription = upsertUserSubscription;
exports.getUserSettings = getUserSettings;
exports.updateUserSettings = updateUserSettings;
// @ts-ignore - allow compile when @supabase/supabase-js types aren't present in local env
const supabase_js_1 = require("@supabase/supabase-js");
let supabase = null;
/**
 * Initialize Supabase client using environment variables.
 * SUPABASE_URL and SUPABASE_KEY must be provided via process.env (secrets).
 */
function initSupabase() {
    if (supabase)
        return supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
    }
    supabase = (0, supabase_js_1.createClient)(url, key, {
        auth: {
            persistSession: false
        }
    });
    return supabase;
}
/**
 * Get Supabase client (initializes if necessary)
 */
function getSupabase() {
    if (!supabase)
        return initSupabase();
    return supabase;
}
/**
 * Save a chat message to the "messages" table.
 * Expected table schema (example):
 *  id (text primary key), sender (text), text (text), country_key (text), timestamp (bigint), status (text)
 */
async function saveMessage(msg) {
    const sb = getSupabase();
    const { error } = await sb.from('messages').insert([{
            id: msg.id,
            sender: msg.sender || msg.type || 'user',
            text: msg.text || msg.content || '',
            country_key: msg.country_key || null,
            timestamp: msg.timestamp || Date.now(),
            status: msg.status || 'complete'
        }]);
    if (error) {
        console.error('Failed to save message to Supabase:', error);
        throw error;
    }
}
/**
 * Fetch recent messages for a conversation (simple helper).
 * Adjust filters/ordering as needed.
 */
async function fetchRecentMessages(limit = 50) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('messages')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
    if (error) {
        console.error('Failed to fetch messages from Supabase:', error);
        throw error;
    }
    return (data || []).map((row) => ({
        id: row.id,
        sender: row.sender,
        text: row.text,
        country_key: row.country_key,
        timestamp: row.timestamp,
        status: row.status
    }));
}
/**
 * Save or upsert a persona into "personas" table.
 * Expected table schema (example):
 *  id (text primary key), country_key (text), displayName (text), locale_hint (text), prompt_text (text), safe_reviewed (boolean)
 */
async function savePersona(persona) {
    const sb = getSupabase();
    const { error } = await sb.from('personas').upsert([{
            id: persona.id,
            country_key: persona.country_key,
            displayName: persona.displayName,
            locale_hint: persona.locale_hint,
            prompt_text: persona.prompt_text,
            safe_reviewed: persona.safe_reviewed,
            created_by: persona.created_by,
            created_at: persona.created_at
        }], { onConflict: 'id' });
    if (error) {
        console.error('Failed to save persona to Supabase:', error);
        throw error;
    }
}
/**
 * Fetch all personas (safe_reviewed filter optional)
 */
async function fetchPersonas(onlySafe = true) {
    const sb = getSupabase();
    let query = sb.from('personas').select('*');
    if (onlySafe)
        query = query.eq('safe_reviewed', true);
    const { data, error } = await query;
    if (error) {
        console.error('Failed to fetch personas from Supabase:', error);
        throw error;
    }
    return (data || []).map((row) => ({
        id: row.id,
        country_key: row.country_key,
        displayName: row.displayName,
        locale_hint: row.locale_hint,
        prompt_text: row.prompt_text,
        safe_reviewed: !!row.safe_reviewed,
        created_by: row.created_by,
        created_at: row.created_at
    }));
}
/**
 * Create a new user
 */
async function createUser(userData) {
    const sb = getSupabase();
    const { data, error } = await sb.from('users').insert([{
            email: userData.email,
            password_hash: userData.password_hash,
            name: userData.name,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }]).select().single();
    if (error) {
        console.error('Failed to create user:', error);
        throw error;
    }
    return data;
}
/**
 * Find user by email
 */
async function findUserByEmail(email) {
    const sb = getSupabase();
    const { data, error } = await sb.from('users').select('*').eq('email', email).single();
    if (error) {
        return null;
    }
    return data;
}
/**
 * Find user by ID
 */
async function findUserById(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from('users').select('*').eq('id', id).single();
    if (error) {
        return null;
    }
    return data;
}
/**
 * Create user session
 */
async function createSession(sessionData) {
    const sb = getSupabase();
    const { data, error } = await sb.from('sessions').insert([{
            user_id: sessionData.user_id,
            token: sessionData.token,
            expires_at: sessionData.expires_at,
            created_at: new Date().toISOString()
        }]).select().single();
    if (error) {
        console.error('Failed to create session:', error);
        throw error;
    }
    return data;
}
/**
 * Find session by token
 */
async function findSessionByToken(token) {
    const sb = getSupabase();
    const { data, error } = await sb.from('sessions').select('*').eq('token', token).single();
    if (error) {
        return null;
    }
    return data;
}
/**
 * Delete expired sessions
 */
async function deleteExpiredSessions() {
    const sb = getSupabase();
    const { error } = await sb.from('sessions').delete().lt('expires_at', new Date().toISOString());
    if (error) {
        console.error('Failed to delete expired sessions:', error);
        throw error;
    }
}
/**
 * Get user subscription
 */
async function getUserSubscription(userId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('subscriptions').select('*').eq('user_id', userId).single();
    if (error) {
        return null;
    }
    return data;
}
/**
 * Create or update user subscription
 */
async function upsertUserSubscription(subscriptionData) {
    const sb = getSupabase();
    const { data, error } = await sb.from('subscriptions').upsert([{
            ...subscriptionData,
            created_at: new Date().toISOString()
        }], { onConflict: 'user_id' }).select().single();
    if (error) {
        console.error('Failed to upsert subscription:', error);
        throw error;
    }
    return data;
}
/**
 * Get user settings
 */
async function getUserSettings(userId) {
    const sb = getSupabase();
    const { data, error } = await sb.from('user_settings').select('*').eq('user_id', userId).single();
    if (error) {
        return null;
    }
    return data;
}
/**
 * Update user settings
 */
async function updateUserSettings(userId, settings) {
    const sb = getSupabase();
    const { data, error } = await sb.from('user_settings').upsert([{
            user_id: userId,
            ...settings
        }], { onConflict: 'user_id' }).select().single();
    if (error) {
        console.error('Failed to update user settings:', error);
        throw error;
    }
    return data;
}
//# sourceMappingURL=db.js.map