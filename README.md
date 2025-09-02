# AI Chat App Server

Backend server for the AI Chat App with Spanish Slang support.

## Features

- WebSocket-based real-time chat
- Persona-driven AI responses with regional Spanish slang
- REST API for persona management
- Streaming LLM responses
- TypeScript support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```env
# Server
PORT=3001
NODE_ENV=development

# LangDB AI LLM Gateway
LANGDB_GATEWAY_URL=https://your-langdb-gateway.example.com/v1/openrouter
LANGDB_API_KEY=your_langdb_api_key_here

# OpenRouter Model
OPENROUTER_MODEL=openrouter/gemini-2.5-flash-lite

# Request Configuration
REQUEST_TIMEOUT=30000
ENABLE_STREAMING=true
```

4. Start the server:
```bash
npm run dev
```

## API Endpoints

### REST API

- `GET /health` - Health check
- `GET /api/personas` - Get list of available personas
- `GET /api/personas/:id` - Get specific persona

### WebSocket Events

#### Client → Server
- `user_message` - Send user message with country selection
  ```json
  {
    "message": "Hola, ¿cómo estás?",
    "selected_country_key": "mex",
    "client_ts": 1640995200000,
    "message_id": "msg_123"
  }
  ```

- `cancel_message` - Cancel ongoing message generation
  ```json
  {
    "message_id": "msg_123"
  }
  ```

#### Server → Client
- `assistant_delta` - Streaming response chunk
  ```json
  {
    "message_id": "msg_123",
    "chunk": "¡Qué padre! Estoy",
    "is_final": false,
    "timestamp": 1640995200000
  }
  ```

- `assistant_final` - Complete response
  ```json
  {
    "message_id": "msg_123",
    "final_content": "¡Qué padre! Estoy muy bien, ¿y vos?",
    "timestamp": 1640995200000
  }
  ```

- `typing_start` / `typing_end` - Typing indicator
- `error` - Error messages

## Persona Management

Personas are stored as JSON files in the `personas/` directory:

- `manifest.json` - List of available personas
- `{country_key}.json` - Individual persona configurations

Each persona includes:
- System prompt with regional slang instructions
- Safety settings
- Metadata (creation date, review status)

## Development

### Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

### Project Structure
```
src/
├── index.ts              # Server entry point
├── types.ts              # TypeScript type definitions
├── routes/
│   └── personas.ts       # Persona REST API routes
└── services/
    ├── chatService.ts    # Chat orchestration
    ├── llmAdapter.ts     # LLM adapter interface
    ├── openrouterAdapter.ts # OpenRouter implementation
    └── personaService.ts # Persona management
personas/
├── manifest.json         # Persona manifest
├── mex.json             # Mexico persona
├── arg.json             # Argentina persona
└── esp.json             # Spain persona
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `LANGDB_GATEWAY_URL` | LangDB gateway endpoint | - |
| `LANGDB_API_KEY` | LangDB API key | - |
| `OPENROUTER_MODEL` | Model to use | `openrouter/gemini-2.5-flash-lite` |
| `REQUEST_TIMEOUT` | Request timeout (ms) | `30000` |
| `ENABLE_STREAMING` | Enable streaming responses | `true` |

## Error Handling

The server includes comprehensive error handling:
- LLM API failures with retry logic
- WebSocket connection issues
- Invalid persona selections
- Request timeouts and cancellations

## Logging

Uses Winston for structured logging with configurable levels. Logs include:
- Request IDs for tracing
- Error details with stack traces
- Performance metrics (response times, token usage)