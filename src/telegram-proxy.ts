/**
 * @file Telegram proxy for OpenClaw commands
 *
 * Proxies messages from the browser to Telegram Bot API.
 * Needed because browser fetch() to api.telegram.org is blocked by CORS.
 * The bot token passes through but is never stored or logged.
 *
 * SECURITY: Requires authenticated user session to prevent abuse as spam relay.
 *
 * NOTE: This handler is imported by the route file which passes `request` directly.
 */
import { auth } from '@/lib/auth';

interface SendRequest {
  botToken: string;
  chatId: string;
  message: string;
}

/** Proxy a message to the Telegram Bot API on behalf of an authenticated user */
export async function POST(request: Request) {
  // Require authenticated user session — prevents unauthenticated abuse
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  let body: SendRequest;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { botToken, chatId, message } = body;

  // Validate required fields
  if (!botToken || !chatId || !message) {
    return Response.json(
      { success: false, error: 'Missing required fields: botToken, chatId, message' },
      { status: 400 }
    );
  }

  // Basic format checks
  if (!/^\d+:/.test(botToken)) {
    return Response.json(
      { success: false, error: 'Invalid bot token format' },
      { status: 400 }
    );
  }

  if (!/^-?\d+$/.test(chatId)) {
    return Response.json(
      { success: false, error: 'Chat ID must be numeric' },
      { status: 400 }
    );
  }

  if (message.length > 4096) {
    return Response.json(
      { success: false, error: 'Message exceeds Telegram 4096 character limit' },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    const data = await telegramResponse.json();

    if (data.ok) {
      return Response.json({ success: true });
    }

    // Map Telegram error codes to user-friendly messages
    const desc = data.description || '';

    if (telegramResponse.status === 401) {
      return Response.json(
        { success: false, error: 'Invalid bot token' },
        { status: 401 }
      );
    }

    if (telegramResponse.status === 400 && desc.includes('chat not found')) {
      return Response.json(
        { success: false, error: 'Chat ID not found. Make sure you\'ve started a conversation with the bot.' },
        { status: 400 }
      );
    }

    if (telegramResponse.status === 429) {
      return Response.json(
        { success: false, error: 'Rate limited. Wait a moment and try again.' },
        { status: 429 }
      );
    }

    return Response.json(
      { success: false, error: desc || 'Telegram API error' },
      { status: telegramResponse.status }
    );
  } catch {
    return Response.json(
      { success: false, error: 'Failed to reach Telegram API' },
      { status: 502 }
    );
  }
}
