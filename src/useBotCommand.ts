/**
 * @file Hook for sending commands to OpenClaw via dual transport
 *
 * Transport methods (user-selectable in /openclaw settings):
 * 1. Tailscale Direct — Browser fetches OpenClaw's /hooks/agent endpoint
 *    via Tailscale private network. Most secure (zero trust, no internet).
 * 2. Telegram — Browser sends to /api/openclaw/send which proxies to
 *    Telegram Bot API. Easiest setup (works from anywhere).
 *
 * Commands are converted to natural language messages that OpenClaw's
 * skills understand. Responses are delivered to the user's Telegram.
 */
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

/** Supported bot commands */
export type BotCommand =
  | 'pool:analyze'    // Analyze a specific pool
  | 'pool:position'   // Check user's position in a pool
  | 'pool:rebalance'  // Suggest rebalancing strategy
  | 'pool:alert'      // Set up price/APR alerts
  | 'pool:set-range'  // Save preferred price range for a pool
  | 'pool:vault'      // Toggle vault deposit (Kuru)
  | 'bot:start'       // Start the bot
  | 'bot:stop'        // Stop the bot
  | 'bot:status';     // Get bot status

/** Command parameters */
export interface CommandParams {
  poolId?: string;
  poolPair?: string;
  poolAddress?: string;
  dex?: string;
  [key: string]: unknown;
}

/**
 * Convert a structured command + params into a natural language message
 * that OpenClaw's skills understand.
 */
function buildCommandMessage(command: BotCommand, params?: CommandParams): string {
  const p = params || {};
  const pool = p.poolPair || 'unknown pool';
  const version = p.clmmVersion ? ` ${(p.clmmVersion as string).toUpperCase()}` : '';
  const dex = `${p.dex || 'unknown DEX'}${version}`;
  const addr = p.poolAddress || '';
  const chain = p.chainId ? `Chain: ${p.chainName || ''} (${p.chainId})` : '';

  const poolLine = addr ? `\nPool: ${addr}${chain ? ` | ${chain}` : ''}` : '';

  switch (command) {
    case 'pool:analyze':
      return `Analyze the ${dex} ${pool} pool.${poolLine}\nReport: current APR, TVL, active bin, position status`;

    case 'pool:position':
      return `Check my position in the ${dex} ${pool} pool.${poolLine}`;

    case 'pool:rebalance':
      return `Rebalance my position in the ${dex} ${pool} pool.${poolLine}`;

    case 'pool:set-range': {
      const range = `${p.minPercent ?? -50}% to +${p.maxPercent ?? 50}%`;
      const mode = p.rangeMode ? ` | Mode: ${p.rangeMode}` : '';
      const bins = p.numBins ? ` | Bins: ${p.numBins}` : '';
      const rebal = p.rebalanceFreq ? `\nRebalance: ${p.rebalanceFreq}` : '';
      return `Deploy my liquidity on ${dex} ${pool} pool.${poolLine}\nRange: ${range}${mode}${bins}${rebal}`;
    }

    case 'pool:alert':
      return `Set alerts for the ${dex} ${pool} pool.${poolLine}\nCurrent APR: ${p.currentApr ?? p.apr ?? '—'}% | TVL: $${p.currentTvl ?? p.tvl ?? '—'}`;

    case 'pool:vault':
      return `Toggle vault deposit for ${dex} ${pool} pool.${poolLine}`;

    case 'bot:start':
      return 'Start monitoring all my positions.';

    case 'bot:stop':
      return 'Stop monitoring all my positions.';

    case 'bot:status':
      return 'Report status of all my positions.\nInclude: position value, P&L, range status, last rebalance time';

    default:
      return `${command}: ${JSON.stringify(params)}`;
  }
}

/**
 * Send a message to OpenClaw directly via Tailscale private network.
 * Auth via x-openclaw-token header (OpenClaw's native auth method).
 * Tailscale already provides the secure transport (zero-trust private network).
 */
async function sendViaTailscale(url: string, token: string, message: string) {
  const controller = new AbortController();
  // 135s = OpenClaw's 120s processing time + 15s buffer for network/response
  const timeout = setTimeout(() => controller.abort(), 135_000);

  try {
    const response = await fetch(`${url}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-openclaw-token': token,
      },
      body: JSON.stringify({
        message,
        name: 'Monadly',
        deliver: true,
        channel: 'telegram',
        timeoutSeconds: 120,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok || response.status === 202) {
      return { success: true };
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid token. Check your OpenClaw hooks.token configuration.');
    }

    const text = await response.text().catch(() => '');
    throw new Error(text || `OpenClaw returned ${response.status}`);
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. OpenClaw may still be processing — check Telegram.');
    }
    throw error;
  }
}

/**
 * Send a message to OpenClaw via Telegram Bot API.
 * Uses /api/openclaw/send as a CORS proxy (the bot token passes
 * through but is never stored server-side).
 */
async function sendViaTelegram(botToken: string, chatId: string, message: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch('/api/openclaw/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, chatId, message }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to send via Telegram');
    }
    return { success: true };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Check your network connection.');
    }
    throw error;
  }
}

/**
 * Hook for sending commands to OpenClaw
 *
 * Reads transport config from localStorage and dispatches to the
 * correct transport (Tailscale or Telegram).
 *
 * @returns Object with sendCommand function and loading state
 *
 * @example
 * ```tsx
 * const { sendCommand, isLoading } = useBotCommand();
 *
 * const handleAnalyze = () => {
 *   sendCommand('pool:analyze', { poolId: 'uni_mon_usdc_0.05%', dex: 'Uniswap' });
 * };
 * ```
 */
/** Connection health status */
export type ConnectionStatus = 'unconfigured' | 'checking' | 'connected' | 'error';

export function useBotCommand() {
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unconfigured');
  const [statusDetail, setStatusDetail] = useState('Loading connection status...');
  const checkRef = useRef(false);

  // Check connection health on mount and when config changes
  useEffect(() => {
    if (checkRef.current) return;
    checkRef.current = true;

    const checkConnection = async () => {
      const transport = localStorage.getItem('openclawTransport') || 'telegram';
      const openclawUrl = localStorage.getItem('openclawUrl');
      const openclawToken = localStorage.getItem('openclawToken');
      const botToken = localStorage.getItem('openclawBotToken');
      const chatId = localStorage.getItem('openclawChatId');

      // Not configured — explain exactly what's missing
      if (transport === 'tailscale') {
        const missingFields: string[] = [];
        if (!openclawUrl) missingFields.push('Tailscale URL');
        if (!openclawToken) missingFields.push('auth token');
        if (missingFields.length > 0) {
          setConnectionStatus('unconfigured');
          setStatusDetail(`Tailscale transport selected but missing ${missingFields.join(' and ')}`);
          return;
        }
      }
      if (transport === 'telegram') {
        const missingFields: string[] = [];
        if (!botToken) missingFields.push('Bot Token');
        if (!chatId) missingFields.push('Chat ID');
        if (missingFields.length > 0) {
          setConnectionStatus('unconfigured');
          setStatusDetail(`Telegram transport selected but missing ${missingFields.join(' and ')}`);
          return;
        }
      }

      if (transport === 'tailscale') {
        setConnectionStatus('checking');
        setStatusDetail(`Pinging Tailscale endpoint at ${openclawUrl}...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          // Lightweight ping — any response (even 401/405) means network is reachable
          const res = await fetch(`${openclawUrl}/hooks/agent`, {
            method: 'OPTIONS',
            signal: controller.signal,
          });
          clearTimeout(timeout);
          // Any HTTP response = reachable (CORS preflight returns 204, auth errors return 401, etc.)
          if (res.ok || res.status === 204 || res.status === 401 || res.status === 405) {
            setConnectionStatus('connected');
            setStatusDetail(`Tailscale connected to ${openclawUrl}`);
          } else {
            setConnectionStatus('error');
            setStatusDetail(`Tailscale endpoint returned HTTP ${res.status} — check that OpenClaw is running at ${openclawUrl}`);
          }
        } catch (err) {
          clearTimeout(timeout);
          setConnectionStatus('error');
          const reason = err instanceof DOMException && err.name === 'AbortError'
            ? 'request timed out after 5s — is the Tailscale node online?'
            : 'host unreachable — check Tailscale is running and the URL is correct';
          setStatusDetail(`Tailscale connection failed: ${reason}`);
        }
      } else {
        // Telegram: if credentials exist, assume connected (no way to ping without sending a message)
        setConnectionStatus('connected');
        setStatusDetail('Telegram credentials configured — ready to send');
      }
    };

    checkConnection();

    // Re-check when localStorage changes (config updated in settings page)
    const handleStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('openclaw')) {
        checkRef.current = false;
        checkConnection();
      }
    };
    const handleConfigChange = () => {
      checkRef.current = false;
      checkConnection();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('openclaw-config-changed', handleConfigChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('openclaw-config-changed', handleConfigChange);
    };
  }, []);

  const sendCommand = useCallback(async (
    command: BotCommand,
    params?: CommandParams
  ): Promise<{ success: boolean; error?: string }> => {
    // Read transport config from localStorage
    const transport = localStorage.getItem('openclawTransport') || 'telegram';
    const openclawUrl = localStorage.getItem('openclawUrl');
    const openclawToken = localStorage.getItem('openclawToken');
    const botToken = localStorage.getItem('openclawBotToken');
    const chatId = localStorage.getItem('openclawChatId');

    // Validate config for selected transport
    if (transport === 'tailscale' && (!openclawUrl || !openclawToken)) {
      const missing = [!openclawUrl && 'Tailscale URL', !openclawToken && 'auth token'].filter(Boolean).join(' and ');
      toast.error(`Tailscale not configured — missing ${missing}. Set up in OpenClaw Settings.`);
      return { success: false, error: 'Not configured' };
    }
    if (transport === 'telegram' && (!botToken || !chatId)) {
      const missing = [!botToken && 'Bot Token', !chatId && 'Chat ID'].filter(Boolean).join(' and ');
      toast.error(`Telegram not configured — missing ${missing}. Set up in OpenClaw Settings.`);
      return { success: false, error: 'Not configured' };
    }

    setIsLoading(true);
    const message = buildCommandMessage(command, params);

    try {
      if (transport === 'tailscale') {
        // Echo command to Telegram so the user sees what was sent
        // (Tailscale delivers directly via HTTP — nothing shows in Telegram otherwise)
        if (botToken && chatId) {
          sendViaTelegram(botToken, chatId, `🦞 *Monadly Command:*\n${message}`).catch(() => {});
        }
        await sendViaTailscale(openclawUrl!, openclawToken!, message);
      } else {
        await sendViaTelegram(botToken!, chatId!, message);
      }
      toast.success(`Command sent via ${transport === 'tailscale' ? 'Tailscale' : 'Telegram'}! Check Telegram for the response.`);
      setConnectionStatus('connected');
      setStatusDetail(transport === 'tailscale' ? `Tailscale connected to ${openclawUrl}` : 'Telegram credentials configured — ready to send');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const detail = transport === 'tailscale'
        ? msg.includes('Invalid token')
          ? `Tailscale auth failed — the token was rejected by ${openclawUrl}. Regenerate it in Settings.`
          : msg.includes('timed out')
            ? `Tailscale request timed out — OpenClaw at ${openclawUrl} is not responding. Check that the node is online.`
            : `Tailscale send failed to ${openclawUrl}: ${msg}`
        : `Telegram send failed: ${msg}`;
      toast.error(detail);
      if (transport === 'tailscale') {
        setConnectionStatus('error');
        setStatusDetail(detail);
      }
      return { success: false, error: detail };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Send a pre-built message directly through the transport (for multi-pool commands like Lombester) */
  const sendRawMessage = useCallback(async (
    message: string
  ): Promise<{ success: boolean; error?: string }> => {
    const transport = localStorage.getItem('openclawTransport') || 'telegram';
    const openclawUrl = localStorage.getItem('openclawUrl');
    const openclawToken = localStorage.getItem('openclawToken');
    const botToken = localStorage.getItem('openclawBotToken');
    const chatId = localStorage.getItem('openclawChatId');

    if (transport === 'tailscale' && (!openclawUrl || !openclawToken)) {
      const missing = [!openclawUrl && 'Tailscale URL', !openclawToken && 'auth token'].filter(Boolean).join(' and ');
      toast.error(`Tailscale not configured — missing ${missing}. Set up in OpenClaw Settings.`);
      return { success: false, error: 'Not configured' };
    }
    if (transport === 'telegram' && (!botToken || !chatId)) {
      const missing = [!botToken && 'Bot Token', !chatId && 'Chat ID'].filter(Boolean).join(' and ');
      toast.error(`Telegram not configured — missing ${missing}. Set up in OpenClaw Settings.`);
      return { success: false, error: 'Not configured' };
    }

    setIsLoading(true);
    try {
      if (transport === 'tailscale') {
        if (botToken && chatId) {
          sendViaTelegram(botToken, chatId, `🦞 *Monadly Command:*\n${message}`).catch(() => {});
        }
        await sendViaTailscale(openclawUrl!, openclawToken!, message);
      } else {
        await sendViaTelegram(botToken!, chatId!, message);
      }
      toast.success(`Strategy sent via ${transport === 'tailscale' ? 'Tailscale' : 'Telegram'}! Check Telegram for the response.`);
      setConnectionStatus('connected');
      setStatusDetail(transport === 'tailscale' ? `Tailscale connected to ${openclawUrl}` : 'Telegram credentials configured — ready to send');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const detail = transport === 'tailscale'
        ? msg.includes('Invalid token')
          ? `Tailscale auth failed — the token was rejected by ${openclawUrl}. Regenerate it in Settings.`
          : msg.includes('timed out')
            ? `Tailscale request timed out — OpenClaw at ${openclawUrl} is not responding. Check that the node is online.`
            : `Tailscale send failed to ${openclawUrl}: ${msg}`
        : `Telegram send failed: ${msg}`;
      toast.error(detail);
      if (transport === 'tailscale') {
        setConnectionStatus('error');
        setStatusDetail(detail);
      }
      return { success: false, error: detail };
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { sendCommand, sendRawMessage, isLoading, connectionStatus, statusDetail };
}
