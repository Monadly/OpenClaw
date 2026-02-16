/**
 * @file OpenClaw configuration hook (localStorage-based)
 *
 * Manages dual transport configuration for Monadly → OpenClaw:
 *
 * 1. Tailscale Direct — URL + bearer token for private network access
 * 2. Telegram — Bot token + chat ID for message-based delivery
 *
 * Storage: Browser localStorage (no database required)
 * Security: Credentials are only used client-side or passed through
 * the Telegram proxy (/api/openclaw/send) without being stored.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';

export type Transport = 'tailscale' | 'telegram';

const STORAGE_KEYS = {
  transport: 'openclawTransport',
  // Tailscale
  openclawUrl: 'openclawUrl',
  openclawToken: 'openclawToken',
  // Telegram
  botToken: 'openclawBotToken',
  chatId: 'openclawChatId',
  // UI
  showCommands: 'openclawShowCommands',
} as const;

export interface OpenClawConfig {
  /** True if the selected transport has all required fields */
  configured: boolean;
  /** Active transport method */
  transport: Transport;
  /** Whether to show OpenClaw commands in the pool table */
  showCommands: boolean;
  // Tailscale credentials
  openclawUrl: string | null;
  openclawToken: string | null;
  // Telegram credentials
  botToken: string | null;
  chatId: string | null;
}

/**
 * Generate a short, copy-paste friendly token
 *
 * Format: mndly_<16 alphanumeric chars>
 * Excludes confusing characters: 0/O, 1/l/I
 *
 * @example "mndly_Kj9xP2mQ4nR7vT5w"
 */
function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = 'mndly_';

  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);

  for (let i = 0; i < 16; i++) {
    token += chars[randomBytes[i] % chars.length];
  }

  return token;
}

/** Determine if config is complete for the given transport */
function isTransportConfigured(
  transport: Transport,
  openclawUrl: string | null,
  openclawToken: string | null,
  botToken: string | null,
  chatId: string | null,
): boolean {
  return transport === 'tailscale'
    ? !!(openclawUrl && openclawToken)
    : !!(botToken && chatId);
}

/** Notify all listeners (same-tab + cross-tab) of config changes */
function notifyConfigChanged() {
  window.dispatchEvent(new CustomEvent('openclaw-config-changed'));
}

/**
 * Hook for managing OpenClaw connection configuration
 *
 * @returns Configuration state and mutation functions
 *
 * @example
 * ```tsx
 * const { config, setTransport, setBotToken, setChatId } = useOpenClawConfig();
 *
 * if (!config.configured) {
 *   return <SetupPrompt />;
 * }
 * ```
 */
export function useOpenClawConfig() {
  const [config, setConfig] = useState<OpenClawConfig>({
    configured: false,
    transport: 'telegram',
    showCommands: true,
    openclawUrl: null,
    openclawToken: null,
    botToken: null,
    chatId: null,
  });

  const [isLoading, setIsLoading] = useState(false);

  // Load from localStorage on mount (client-side only)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadConfig = () => {
      const transport = (localStorage.getItem(STORAGE_KEYS.transport) as Transport) || 'telegram';
      const openclawUrl = localStorage.getItem(STORAGE_KEYS.openclawUrl);
      const openclawToken = localStorage.getItem(STORAGE_KEYS.openclawToken);
      const botToken = localStorage.getItem(STORAGE_KEYS.botToken);
      const chatId = localStorage.getItem(STORAGE_KEYS.chatId);
      const showCommandsStr = localStorage.getItem(STORAGE_KEYS.showCommands);
      const showCommands = showCommandsStr === null ? true : showCommandsStr === 'true';

      setConfig({
        configured: isTransportConfigured(transport, openclawUrl, openclawToken, botToken, chatId),
        transport,
        showCommands,
        openclawUrl,
        openclawToken,
        botToken,
        chatId,
      });
    };

    loadConfig();

    // Cross-tab sync via StorageEvent
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && Object.values(STORAGE_KEYS).includes(e.key as typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS])) {
        loadConfig();
      }
    };

    // Same-tab sync via CustomEvent
    const handleCustomEvent = () => loadConfig();

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('openclaw-config-changed', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('openclaw-config-changed', handleCustomEvent);
    };
  }, []);

  const setTransport = useCallback((transport: Transport) => {
    localStorage.setItem(STORAGE_KEYS.transport, transport);
    setConfig(prev => ({
      ...prev,
      transport,
      configured: isTransportConfigured(transport, prev.openclawUrl, prev.openclawToken, prev.botToken, prev.chatId),
    }));
    notifyConfigChanged();
  }, []);

  const setOpenclawUrl = useCallback((url: string) => {
    let normalized = url.trim().replace(/\/+$/, '');

    // Auto-prepend https:// if no protocol (tailscale status gives bare hostnames)
    if (normalized && !/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }

    // Validate URL structure
    try {
      const parsed = new URL(normalized);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        toast.error('URL must use https:// or http://');
        return;
      }
    } catch {
      toast.error('Invalid URL format');
      return;
    }

    // Strip endpoint path if user pasted the full URL (prevents /hooks/agent/hooks/agent)
    normalized = normalized.replace(/\/hooks\/agent\/?$/i, '');

    localStorage.setItem(STORAGE_KEYS.openclawUrl, normalized);
    setConfig(prev => ({
      ...prev,
      openclawUrl: normalized,
      configured: isTransportConfigured(prev.transport, normalized, prev.openclawToken, prev.botToken, prev.chatId),
    }));
    toast.success('Tailscale URL saved!');
    notifyConfigChanged();
  }, []);

  const setOpenclawToken = useCallback((token: string) => {
    localStorage.setItem(STORAGE_KEYS.openclawToken, token);
    setConfig(prev => ({
      ...prev,
      openclawToken: token,
      configured: isTransportConfigured(prev.transport, prev.openclawUrl, token, prev.botToken, prev.chatId),
    }));
    toast.success('Token saved!');
    notifyConfigChanged();
  }, []);

  const setBotToken = useCallback((token: string) => {
    localStorage.setItem(STORAGE_KEYS.botToken, token);
    setConfig(prev => ({
      ...prev,
      botToken: token,
      configured: isTransportConfigured(prev.transport, prev.openclawUrl, prev.openclawToken, token, prev.chatId),
    }));
    toast.success('Bot token saved!');
    notifyConfigChanged();
  }, []);

  const setChatId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEYS.chatId, id);
    setConfig(prev => ({
      ...prev,
      chatId: id,
      configured: isTransportConfigured(prev.transport, prev.openclawUrl, prev.openclawToken, prev.botToken, id),
    }));
    toast.success('Chat ID saved!');
    notifyConfigChanged();
  }, []);

  const createToken = useCallback(() => {
    setIsLoading(true);
    try {
      const newToken = generateToken();
      setOpenclawToken(newToken);
      return newToken;
    } finally {
      setIsLoading(false);
    }
  }, [setOpenclawToken]);

  const setShowCommands = useCallback((show: boolean) => {
    localStorage.setItem(STORAGE_KEYS.showCommands, String(show));
    setConfig(prev => ({ ...prev, showCommands: show }));
    notifyConfigChanged();
  }, []);

  const clearConfig = useCallback(() => {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    setConfig({
      configured: false,
      transport: 'telegram',
      showCommands: true,
      openclawUrl: null,
      openclawToken: null,
      botToken: null,
      chatId: null,
    });
    toast.success('OpenClaw config cleared');
    notifyConfigChanged();
  }, []);

  return {
    config,
    isLoading,
    setTransport,
    setOpenclawUrl,
    setOpenclawToken,
    setBotToken,
    setChatId,
    createToken,
    setShowCommands,
    clearConfig,
  };
}
