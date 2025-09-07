# AI Chat App Server

Backend server for the AI Chat App with Spanish Slang support.

## Featuress

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

## Recent Fixes (September 2025)

### Critical Chat Functionality Fixes

**1. WebSocket Event Mismatch Fixed**
- **Issue**: Frontend was emitting `'message'` event but backend expected `'user_message'`
- **Fix**: Updated frontend to emit `'user_message'` event directly with data payload
- **Result**: WebSocket connections now remain stable during message sending

**2. Missing Startup Validation**
- **Issue**: `validateStartup()` function was defined but never called
- **Fix**: Added startup validation call in server initialization
- **Result**: Server now validates all dependencies on startup

**3. Enhanced Debugging**
- **Frontend**: Added comprehensive logging for message sending and response handling
- **Backend**: Added detailed logging for message processing and LLM responses
- **Result**: Improved troubleshooting and monitoring capabilities

## Quick Start

### Prerequisites
- Node.js 18+
- Railway account (for backend deployment)
- Vercel account (for frontend deployment)
- LangDB API key and gateway URL

### Environment Setup

1. **Railway Backend Environment Variables**:
```env
FRONTEND_URL=https://your-vercel-app.vercel.app,http://localhost:3000
PORT=3001
NODE_ENV=production
LANGDB_API_KEY=your_langdb_api_key
LANGDB_GATEWAY_URL=https://your-langdb-gateway-url/v1
LANGDB_MODEL=anthropic/claude-sonnet-4
ENABLE_STREAMING=true
REQUEST_TIMEOUT=30000
```

2. **Vercel Frontend Environment Variables**:
```env
NEXT_PUBLIC_BACKEND_URL=https://your-railway-app.railway.app
```

### Deployment Steps

1. **Deploy Backend to Railway**:
```bash
cd server
npm install
npm run build
railway deploy
```

2. **Deploy Frontend to Vercel**:
```bash
cd klkfront
npm install
npm run build
vercel --prod
```

3. **Test Deployment**:
```bash
# Run the test script
./test_chat.sh
```

## Testing the Chat Feature

### Automated Testing
Run the comprehensive test script:
```bash
./test_chat.sh
```

This will test:
- Backend health endpoint
- Personas API
- WebSocket connectivity
- Frontend accessibility

### Manual Testing
1. Open your Vercel frontend URL
2. Select a country (Mexico, Argentina, or Spain)
3. Send a message like "Hola, ¿cómo estás?"
4. Verify you receive a response in the selected country's dialect
5. Check browser console for debug logs
6. Monitor Railway logs for backend processing

### Expected Behavior
- ✅ WebSocket connection stays stable
- ✅ Messages are sent without disconnection
- ✅ Assistant responses appear in chat
- ✅ Responses use appropriate regional Spanish
- ✅ Debug logs show message flow

## Troubleshooting

### WebSocket Issues
- Check Railway logs for "WEBSOCKET CONNECTED" messages
- Verify frontend is using correct backend URL
- Ensure CORS headers are properly configured

### LLM Response Issues
- Verify `LANGDB_API_KEY` and `LANGDB_GATEWAY_URL` are set
- Check Railway logs for LLM adapter readiness
- Ensure model name is correct in environment variables

### Persona Loading Issues
- Check `/api/personas` endpoint returns valid JSON
- Verify persona files exist in `server/personas/` directory
- Ensure personas are marked as `safe_reviewed: true`

## Debug Logs

### Frontend Console Logs (Expected)
```
🔍 API CONFIGURATION: Backend URL: https://your-app.railway.app
🔌 INITIALIZING WEBSOCKET CONNECTION...
✅ WEBSOCKET CONNECTED: [socket_id]
📤 SENDING MESSAGE: { message: "Hola", country: "mex" }
📤 MESSAGE SENT
📨 RECEIVED assistant_delta: { message_id: "...", chunk: "¡Qué padre! ..." }
📨 RECEIVED assistant_final: { message_id: "...", final_content: "..." }
```

### Backend Railway Logs (Expected)
```
✅ SERVER SUCCESSFULLY RUNNING ON PORT 3001
🔧 Startup validation result: PASS
🔌 Client connected: [socket_id]
📨 RECEIVED user_message: { message: "Hola", selected_country_key: "mex", ... }
🤖 PROCESSING MESSAGE: [message_id] - "Hola" for country: mex
✅ USING PERSONA: México (mex)
🚀 CALLING LLM: 2 messages
📝 STARTING STREAM: [message_id]
✅ LLM RESPONSE COMPLETE: [message_id] (150 chars)
```

## API Endpoints

- `GET /health` - Health check with startup validation status
- `GET /api/personas` - List available personas
- `GET /api/personas/:id` - Get specific persona

## WebSocket Events

### Client → Server
- `user_message` - Send user message with country selection

### Server → Client
- `assistant_delta` - Streaming response chunks
- `assistant_final` - Complete response
- `typing_start` / `typing_end` - Typing indicators
- `error` - Error messages

## Support

If you encounter issues:
1. Run `./test_chat.sh` to diagnose problems
2. Check Railway and Vercel deployment logs
3. Verify environment variables are correctly set
4. Ensure LangDB credentials are valid
5. Test WebSocket connectivity manually

## Project Structure
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