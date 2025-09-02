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
//# sourceMappingURL=db.d.ts.map