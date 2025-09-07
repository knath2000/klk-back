import { SupabaseClient } from '@supabase/supabase-js';
import { Message, Persona } from '../types';
/**
 * Initialize Supabase client using environment variables.
 * SUPABASE_URL and SUPABASE_KEY must be provided via process.env (secrets).
 */
export declare function initSupabase(): SupabaseClient;
/**
 * Get Supabase client (initializes if necessary)
 */
export declare function getSupabase(): SupabaseClient;
/**
 * Save a chat message to the "messages" table.
 * Expected table schema (example):
 *  id (text primary key), sender (text), text (text), country_key (text), timestamp (bigint), status (text)
 */
export declare function saveMessage(msg: Message): Promise<void>;
/**
 * Fetch recent messages for a conversation (simple helper).
 * Adjust filters/ordering as needed.
 */
export declare function fetchRecentMessages(limit?: number): Promise<Message[]>;
/**
 * Save or upsert a persona into "personas" table.
 * Expected table schema (example):
 *  id (text primary key), country_key (text), displayName (text), locale_hint (text), prompt_text (text), safe_reviewed (boolean)
 */
export declare function savePersona(persona: Persona): Promise<void>;
/**
 * Fetch all personas (safe_reviewed filter optional)
 */
export declare function fetchPersonas(onlySafe?: boolean): Promise<Persona[]>;
/**
 * User management functions
 */
export interface User {
    id: string;
    email: string;
    name?: string;
    image?: string;
    password_hash?: string;
    created_at: string;
    updated_at: string;
}
export interface Session {
    id: string;
    user_id: string;
    token: string;
    expires_at: string;
    created_at: string;
}
export interface Subscription {
    id: string;
    user_id: string;
    plan: string;
    status: string;
    current_period_start: string;
    current_period_end: string;
    created_at: string;
}
export interface UserSettings {
    user_id: string;
    theme: 'light' | 'dark' | 'system';
    language: string;
    default_model: string;
    default_persona?: string;
    message_history_limit: number;
    auto_save: boolean;
    notifications_enabled: boolean;
    local_storage_enabled: boolean;
    conversation_sync_enabled: boolean;
}
/**
 * Create a new user
 */
export declare function createUser(userData: {
    email: string;
    password_hash: string;
    name?: string;
}): Promise<User>;
/**
 * Find user by email
 */
export declare function findUserByEmail(email: string): Promise<User | null>;
/**
 * Find user by ID
 */
export declare function findUserById(id: string): Promise<User | null>;
/**
 * Create user session
 */
export declare function createSession(sessionData: {
    user_id: string;
    token: string;
    expires_at: string;
}): Promise<Session>;
/**
 * Find session by token
 */
export declare function findSessionByToken(token: string): Promise<Session | null>;
/**
 * Delete expired sessions
 */
export declare function deleteExpiredSessions(): Promise<void>;
/**
 * Get user subscription
 */
export declare function getUserSubscription(userId: string): Promise<Subscription | null>;
/**
 * Create or update user subscription
 */
export declare function upsertUserSubscription(subscriptionData: Omit<Subscription, 'created_at'>): Promise<Subscription>;
/**
 * Get user settings
 */
export declare function getUserSettings(userId: string): Promise<UserSettings | null>;
/**
 * Update user settings
 */
export declare function updateUserSettings(userId: string, settings: Partial<UserSettings>): Promise<UserSettings>;
//# sourceMappingURL=db.d.ts.map