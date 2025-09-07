// @ts-ignore - allow compile when @supabase/supabase-js types aren't present in local env
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Message, Persona } from '../types';

let supabase: SupabaseClient | null = null;

/**
 * Initialize Supabase client using environment variables.
 * SUPABASE_URL and SUPABASE_KEY must be provided via process.env (secrets).
 */
export function initSupabase(): SupabaseClient {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
  }

  supabase = createClient(url, key, {
    auth: {
      persistSession: false
    }
  });

  return supabase;
}

/**
 * Get Supabase client (initializes if necessary)
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) return initSupabase();
  return supabase;
}

/**
 * Save a chat message to the "messages" table.
 * Expected table schema (example):
 *  id (text primary key), sender (text), text (text), country_key (text), timestamp (bigint), status (text)
 */
export async function saveMessage(msg: Message): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('messages').insert([{
    id: msg.id,
    sender: msg.sender || (msg as any).type || 'user',
    text: msg.text || (msg as any).content || '',
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
export async function fetchRecentMessages(limit = 50): Promise<Message[]> {
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

  return (data || []).map((row: any) => ({
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
export async function savePersona(persona: Persona): Promise<void> {
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
export async function fetchPersonas(onlySafe = true): Promise<Persona[]> {
  const sb = getSupabase();
  let query = sb.from('personas').select('*');
  if (onlySafe) query = query.eq('safe_reviewed', true);
  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch personas from Supabase:', error);
    throw error;
  }

  return (data || []).map((row: any) => ({
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
  plan: string; // 'free', 'pro', 'premium'
  status: string; // 'active', 'cancelled', 'expired'
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
export async function createUser(userData: { email: string; password_hash: string; name?: string }): Promise<User> {
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
export async function findUserByEmail(email: string): Promise<User | null> {
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
export async function findUserById(id: string): Promise<User | null> {
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
export async function createSession(sessionData: { user_id: string; token: string; expires_at: string }): Promise<Session> {
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
export async function findSessionByToken(token: string): Promise<Session | null> {
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
export async function deleteExpiredSessions(): Promise<void> {
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
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
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
export async function upsertUserSubscription(subscriptionData: Omit<Subscription, 'created_at'>): Promise<Subscription> {
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
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
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
export async function updateUserSettings(userId: string, settings: Partial<UserSettings>): Promise<UserSettings> {
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
