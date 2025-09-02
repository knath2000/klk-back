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

