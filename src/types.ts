// Server-side types for the AI Chat App

export interface Persona {
  id: string;
  country_key: string;
  displayName: string;
  locale_hint: string;
  prompt_text: string;
  safe_reviewed: boolean;
  created_by: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id?: string;
  sender: 'user' | 'assistant';
  text: string;
  country_key?: string;
  timestamp: number;
  status: 'partial' | 'complete';
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeltaChunk {
  deltaText?: string;
  isFinal?: boolean;
  meta?: any;
}

export interface LLMOptions {
  model: string;
  timeout?: number;
  requestId?: string;
}

export interface UserMessagePayload {
  message: string;
  selected_country_key: string;
  client_ts: number;
  message_id: string;
}

export interface AssistantDeltaPayload {
  message_id: string;
  chunk: string;
  is_final: boolean;
  timestamp: number;
}

export interface AssistantFinalPayload {
  message_id: string;
  final_content: string;
  timestamp: number;
}

export interface TypingPayload {
  country_key: string;
  timestamp: number;
}

// API Response types
export interface PersonasResponse {
  personas: Persona[];
}

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: any;
}