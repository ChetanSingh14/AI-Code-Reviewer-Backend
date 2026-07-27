import { Server, Socket } from 'socket.io';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { env } from '../../config/env';
import { logger } from '../../shared/utils/logger';

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY,
});

export function initializeReviewSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    logger.info(`🔌 WebSocket Client connected: ${socket.id}`);

    // Join a discussion room for a specific code review
    socket.on('join_session', (reviewId: string) => {
      socket.join(reviewId);
      logger.info(`👥 Socket ${socket.id} joined review session: ${reviewId}`);
    });

    // Handle user message in the discussion room
    socket.on('send_message', async (data: {
      reviewId: string;
      codeContext: string;
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => {
      const { reviewId, codeContext, message, history } = data;
      logger.info(`💬 Received chat message for review ${reviewId} from socket ${socket.id}`);

      try {
        // Construct the message thread for Gemini
        const systemPrompt = `You are an expert AI Code Reviewer and pair programming partner.
The user is discussing a code review generated for the following code snippet:
\`\`\`
${codeContext}
\`\`\`

Answer the user's questions, explain potential issues, and suggest concrete code changes or improvements. Keep your responses helpful, concise, and focused on clean code and security.`;

        // Format history to match Vercel AI SDK CoreMessage structure
        const coreMessages = [
          ...history.map((h) => ({
            role: h.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: h.content,
          })),
          {
            role: 'user' as const,
            content: message,
          },
        ];

        // Call streamText from Vercel AI SDK
        const { textStream } = await streamText({
          model: google('gemini-3.5-flash'),
          system: systemPrompt,
          messages: coreMessages,
        });

        // Pipe chunks to the client over WebSockets
        for await (const textPart of textStream) {
          socket.emit('chat_chunk', {
            reviewId,
            text: textPart,
          });
        }

        // Notify client that the stream is finished
        socket.emit('chat_done', { reviewId });
        logger.info(`🏁 Finished streaming response to review ${reviewId}`);
      } catch (err: any) {
        logger.error(`❌ WebSocket Chat Stream Error for review ${reviewId}:`, err);
        socket.emit('chat_error', {
          reviewId,
          error: err.message || 'Failed to generate chat response',
        });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`🔌 WebSocket Client disconnected: ${socket.id}`);
    });
  });
}
