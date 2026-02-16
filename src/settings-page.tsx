/**
 * @file OpenClaw settings page - Monadly native design
 *
 * Full-page settings for OpenClaw integration with dual transport:
 * - Tailscale Direct (zero trust, most secure)
 * - Telegram (easiest setup)
 *
 * Users choose their transport method and configure credentials.
 * Commands are sent from pool table rows and bot controls here.
 */
'use client';

import { useState } from 'react';
import { Copy, RefreshCw, Play, Square, Activity, Check, ArrowLeft, Zap, Shield, MessageCircle, Terminal, FileJson, Package, Wifi, Send } from 'lucide-react';
import { useOpenClawConfig, type Transport } from '@openclaw/useOpenClawConfig';
import { useBotCommand, type BotCommand } from '@openclaw/useBotCommand';
import { toast } from 'sonner';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Accent color for OpenClaw (lobster red-orange)
const ACCENT_COLOR = '#ff6b4a';

export default function OpenClawSettingsPage() {
  const {
    config, isLoading, createToken, setTransport, setOpenclawUrl,
    setOpenclawToken, setBotToken, setChatId, clearConfig, setShowCommands,
  } = useOpenClawConfig();
  const { sendCommand, isLoading: commandLoading } = useBotCommand();

  // Input states
  const [urlInput, setUrlInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [botTokenInput, setBotTokenInput] = useState('');
  const [chatIdInput, setChatIdInput] = useState('');

  // UI states
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [configTab, setConfigTab] = useState<'json' | 'cli'>('cli');
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [skillsTab, setSkillsTab] = useState<'natural' | 'cli' | 'json'>('natural');
  const [copiedSkillsCmd, setCopiedSkillsCmd] = useState(false);
  const [copiedDownload, setCopiedDownload] = useState(false);

  const copyToken = async () => {
    if (config.openclawToken) {
      await navigator.clipboard.writeText(config.openclawToken);
      setCopied(true);
      toast.success('Token copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCommand = async (cmd: BotCommand) => {
    await sendCommand(cmd);
  };

  const handleSaveUrl = () => {
    if (urlInput.trim()) {
      setOpenclawUrl(urlInput.trim());
      setUrlInput('');
    }
  };

  const handleSaveToken = () => {
    if (tokenInput.trim()) {
      setOpenclawToken(tokenInput.trim());
      setTokenInput('');
    }
  };

  const handleSaveBotToken = () => {
    if (botTokenInput.trim()) {
      setBotToken(botTokenInput.trim());
      setBotTokenInput('');
    }
  };

  const handleSaveChatId = () => {
    if (chatIdInput.trim()) {
      setChatId(chatIdInput.trim());
      setChatIdInput('');
    }
  };

  const handleTestConnection = () => {
    sendCommand('bot:status', {});
  };

  // CLI command for configuring OpenClaw token (real value for clipboard, masked for display)
  const cliCommand = config.openclawToken
    ? `openclaw config set hooks.token "${config.openclawToken}"`
    : '';
  const cliCommandMasked = config.openclawToken
    ? `openclaw config set hooks.token "${showToken ? config.openclawToken : '\u2022'.repeat(22)}"`
    : '';

  const copyCommand = async () => {
    if (cliCommand) {
      await navigator.clipboard.writeText(cliCommand);
      setCopiedCommand(true);
      toast.success('Command copied to clipboard!');
      setTimeout(() => setCopiedCommand(false), 2000);
    }
  };

  // Skills installation commands
  const skillsDownloadCmd = 'Download all Monadly DeFi skills from https://github.com/Monadly/OpenClaw/tree/main/skills into ~/.openclaw/skills/';
  const skillsNaturalCmd = 'Register my skills at ~/.openclaw/skills';
  const skillsCliCmd = 'openclaw config set skills.load.extraDirs \'["~/.openclaw/skills"]\'';
  const skillsJsonSnippet = `{
  "skills": {
    "load": {
      "extraDirs": ["~/.openclaw/skills"]
    }
  }
}`;

  const copySkillsCmd = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedSkillsCmd(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopiedSkillsCmd(false), 2000);
  };

  const copyDownloadCmd = async () => {
    await navigator.clipboard.writeText(skillsDownloadCmd);
    setCopiedDownload(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopiedDownload(false), 2000);
  };

  return (
    <main className="min-h-screen px-3 py-6 sm:px-4 sm:py-8 md:px-6 lg:px-10 xl:px-12 max-w-screen-2xl mx-auto" style={{ '--dex-accent': ACCENT_COLOR } as React.CSSProperties}>
      {/* Back Navigation */}
      <Link
        href="/openclaw"
        className="inline-flex items-center gap-1.5 text-sm text-monad-purple-light/60 hover:text-white transition-colors mb-6 group"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        Back to OpenClaw
      </Link>

      {/* Hero Header */}
      <div className="relative mb-8">
        <div
          className="absolute -inset-4 blur-3xl opacity-20 -z-10"
          style={{ background: `radial-gradient(ellipse at center, ${ACCENT_COLOR}, transparent 70%)` }}
        />
        <div className="flex items-start gap-4">
          <div
            className="relative flex items-center justify-center w-14 h-14 rounded-2xl backdrop-blur-md"
            style={{
              background: `linear-gradient(135deg, ${ACCENT_COLOR}20 0%, ${ACCENT_COLOR}08 100%)`,
              border: `1px solid ${ACCENT_COLOR}30`,
              boxShadow: `0 0 32px ${ACCENT_COLOR}25, inset 0 1px 0 ${ACCENT_COLOR}20`,
            }}
          >
            <div
              className="absolute inset-0 rounded-2xl opacity-50"
              style={{ background: `radial-gradient(circle at 50% 0%, ${ACCENT_COLOR}40 0%, transparent 60%)` }}
            />
            <span className="text-3xl relative z-10">🦞</span>
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">OpenClaw Integration</h1>
            <p className="text-monad-purple-light/50 mt-1">
              Connect your AI trading bot to Monadly for seamless DeFi automation
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Show Commands Toggle + Bot Controls Card */}
        <GlassCard accentColor={ACCENT_COLOR} className="lg:col-span-2">
          {/* Show OpenClaw Commands Toggle */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
            <div>
              <span className="text-sm font-medium text-white/90">Show OpenClaw Commands</span>
              <p className="text-[11px] text-white/40 mt-0.5">Display 🦞 button in pool table rows</p>
            </div>
            <button
              onClick={() => setShowCommands(!config.showCommands)}
              className={cn(
                'relative w-12 h-7 rounded-full transition-colors duration-200',
                config.showCommands ? 'bg-monad-purple' : 'bg-white/10'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 flex items-center justify-center text-[9px] font-bold',
                  config.showCommands ? 'left-6' : 'left-1'
                )}
                style={{ color: config.showCommands ? '#6e54ff' : '#666' }}
              >
                {config.showCommands ? '✓' : ''}
              </span>
            </button>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${ACCENT_COLOR}20`, border: `1px solid ${ACCENT_COLOR}30` }}
            >
              <Zap className="w-4 h-4" style={{ color: ACCENT_COLOR }} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white/95 tracking-tight">Quick Actions</h2>
              <p className="text-[11px] text-white/40">Control your OpenClaw bot directly from Monadly</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <ActionButton
              icon={<Play className="w-5 h-5" />}
              label="Start Bot"
              color="#22c55e"
              onClick={() => handleCommand('bot:start')}
              disabled={commandLoading || !config.configured}
            />
            <ActionButton
              icon={<Square className="w-5 h-5" />}
              label="Stop Bot"
              color="#ef4444"
              onClick={() => handleCommand('bot:stop')}
              disabled={commandLoading || !config.configured}
            />
            <ActionButton
              icon={<Activity className="w-5 h-5" />}
              label="Get Status"
              color="#6e54ff"
              onClick={() => handleCommand('bot:status')}
              disabled={commandLoading || !config.configured}
            />
          </div>

          {!config.configured && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400/90">
              Complete the pairing setup below to enable bot controls
            </div>
          )}
        </GlassCard>

        {/* Transport Selector Card */}
        <GlassCard accentColor={ACCENT_COLOR} className="lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${ACCENT_COLOR}20`, border: `1px solid ${ACCENT_COLOR}30` }}
            >
              <Shield className="w-4 h-4" style={{ color: ACCENT_COLOR }} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white/95 tracking-tight">Connection Method</h2>
              <p className="text-[11px] text-white/40">Choose how Monadly sends commands to your OpenClaw</p>
            </div>
          </div>

          {/* Transport Cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <TransportCard
              transport="tailscale"
              selected={config.transport === 'tailscale'}
              icon={<Wifi className="w-5 h-5" />}
              title="Tailscale Direct"
              badge="Most Secure"
              description="Zero trust private network. Commands go directly from your browser to OpenClaw."
              onSelect={() => setTransport('tailscale')}
              accentColor={ACCENT_COLOR}
            />
            <TransportCard
              transport="telegram"
              selected={false}
              icon={<Send className="w-5 h-5" />}
              title="Telegram"
              badge="Coming Soon"
              description="Browser-to-Telegram integration is in development. For now, use the Copy button in the Command Center to send strategies manually."
              onSelect={() => {}}
              accentColor={ACCENT_COLOR}
              disabled
            />
          </div>

          {/* Tailscale Config */}
          {config.transport === 'tailscale' && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              {/* Token */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white/60">OpenClaw Token</label>
                  <div className="flex items-center gap-2">
                    {config.openclawToken && (
                      <button
                        onClick={() => setShowToken(!showToken)}
                        className="text-[10px] text-monad-purple-light/50 hover:text-monad-purple-light"
                      >
                        {showToken ? 'Hide' : 'Show'}
                      </button>
                    )}
                    {config.openclawToken && (
                      <button
                        onClick={copyToken}
                        className="text-[10px] text-monad-cyan hover:text-monad-cyan-pale flex items-center gap-1"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 h-10 px-3 rounded-lg bg-black/40 border border-white/10 flex items-center overflow-hidden">
                    <code className="text-sm text-monad-purple-light/80 truncate">
                      {config.openclawToken
                        ? (showToken ? config.openclawToken : '\u2022'.repeat(22))
                        : 'Click generate to create a token'
                      }
                    </code>
                  </div>
                  <button
                    onClick={createToken}
                    disabled={isLoading}
                    className="h-10 px-4 rounded-lg font-medium text-sm transition-all flex items-center gap-2"
                    style={{
                      background: `linear-gradient(135deg, ${ACCENT_COLOR}30 0%, ${ACCENT_COLOR}15 100%)`,
                      border: `1px solid ${ACCENT_COLOR}40`,
                      color: ACCENT_COLOR,
                    }}
                  >
                    <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
                    {config.openclawToken ? 'Regenerate' : 'Generate'}
                  </button>
                </div>
                <p className="text-[10px] text-white/30">
                  After generating, run: <code className="text-monad-cyan/60">openclaw config set hooks.token &quot;{showToken ? (config.openclawToken || 'mndly_xxx') : '\u2022\u2022\u2022'}&quot;</code>
                  {!showToken && config.openclawToken && <span className="text-white/20"> (click Show above to reveal)</span>}
                </p>
              </div>

              {/* Or paste existing token */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/60">Or paste an existing token</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="mndly_Kj9xP2mQ4nR7vT5w"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
                    className="flex-1 h-10 px-3 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-monad-purple/50 focus-visible:ring-0 shadow-none transition-colors"
                  />
                  <button
                    onClick={handleSaveToken}
                    disabled={!tokenInput.trim()}
                    className="h-10 px-4 rounded-lg font-medium text-sm bg-monad-purple/30 hover:bg-monad-purple/50 text-monad-purple-light border border-monad-purple/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Tailscale URL */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/60">Tailscale URL</label>
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="https://your-machine.tail1234.ts.net"
                    value={urlInput || config.openclawUrl || ''}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveUrl()}
                    autoComplete="off"
                    className="flex-1 h-10 px-3 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-monad-purple/50 focus-visible:ring-0 shadow-none transition-colors"
                  />
                  <button
                    onClick={handleSaveUrl}
                    disabled={!urlInput.trim()}
                    className="h-10 px-4 rounded-lg font-medium text-sm bg-monad-purple/30 hover:bg-monad-purple/50 text-monad-purple-light border border-monad-purple/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                {config.openclawUrl && (
                  <p className="text-[11px] text-green-400/70 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Connected to {config.openclawUrl}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Telegram Config */}
          {config.transport === 'telegram' && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              {/* Bot Token */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/60">Telegram Bot Token</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="123456789:ABCdefGHI..."
                    value={botTokenInput || config.botToken || ''}
                    onChange={(e) => setBotTokenInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveBotToken()}
                    className="flex-1 h-10 px-3 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-monad-purple/50 focus-visible:ring-0 shadow-none transition-colors"
                  />
                  <button
                    onClick={handleSaveBotToken}
                    disabled={!botTokenInput.trim()}
                    className="h-10 px-4 rounded-lg font-medium text-sm bg-monad-purple/30 hover:bg-monad-purple/50 text-monad-purple-light border border-monad-purple/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                {config.botToken && (
                  <p className="text-[11px] text-green-400/70 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Bot token saved
                  </p>
                )}
              </div>

              {/* Chat ID */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/60">Chat ID</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="389908939"
                    value={chatIdInput || config.chatId || ''}
                    onChange={(e) => setChatIdInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveChatId()}
                    className="flex-1 h-10 px-3 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-monad-purple/50 focus-visible:ring-0 shadow-none transition-colors"
                  />
                  <button
                    onClick={handleSaveChatId}
                    disabled={!chatIdInput.trim()}
                    className="h-10 px-4 rounded-lg font-medium text-sm bg-monad-purple/30 hover:bg-monad-purple/50 text-monad-purple-light border border-monad-purple/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                {config.chatId && (
                  <p className="text-[11px] text-green-400/70 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Chat ID saved
                  </p>
                )}
              </div>

              {/* Security note */}
              <div className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-400/80">
                Your bot token passes through Monadly's server to reach Telegram. It is not stored.
              </div>
            </div>
          )}

          {/* Test Connection + Clear */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/10">
            {config.configured && (
              <button
                onClick={handleTestConnection}
                disabled={commandLoading}
                className="h-9 px-4 rounded-lg font-medium text-sm transition-all flex items-center gap-2"
                style={{
                  background: `linear-gradient(135deg, ${ACCENT_COLOR}30 0%, ${ACCENT_COLOR}15 100%)`,
                  border: `1px solid ${ACCENT_COLOR}40`,
                  color: ACCENT_COLOR,
                }}
              >
                <Activity className="w-3.5 h-3.5" />
                Test Connection
              </button>
            )}
            {(config.openclawToken || config.openclawUrl || config.botToken || config.chatId) && (
              <button
                onClick={clearConfig}
                className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
              >
                Clear all configuration
              </button>
            )}
          </div>
        </GlassCard>

        {/* Response Delivery Card */}
        <GlassCard accentColor="#85e6ff">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(133, 230, 255, 0.2)', border: '1px solid rgba(133, 230, 255, 0.3)' }}
            >
              <MessageCircle className="w-4 h-4 text-monad-cyan" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white/95 tracking-tight">Response Delivery</h2>
              <p className="text-[11px] text-white/40">How OpenClaw communicates back to you</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-monad-cyan/5 border border-monad-cyan/20">
              <div className="w-10 h-10 rounded-lg bg-[#0088cc]/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#0088cc]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white/90">Telegram</p>
                <p className="text-[11px] text-white/40">Bot responses are delivered to your Telegram</p>
              </div>
            </div>
            <p className="text-[11px] text-white/30">
              Bot responses, alerts, and status updates are sent to the Telegram chat configured above.
            </p>
          </div>
        </GlassCard>
      </div>

      {/* Skills Installation */}
      <div className="mt-6">
        <GlassCard accentColor={ACCENT_COLOR}>
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${ACCENT_COLOR}20`, border: `1px solid ${ACCENT_COLOR}30` }}
            >
              <Package className="w-4 h-4" style={{ color: ACCENT_COLOR }} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white/95 tracking-tight">Install Monadly Skills</h2>
              <p className="text-[11px] text-white/40">Teach your OpenClaw how to manage DeFi positions on Monad</p>
            </div>
          </div>

          {/* What gets installed */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            {[
              { name: 'monadly-core', desc: 'Safety & orchestration' },
              { name: 'lfj-liquidity', desc: 'LFJ Liquidity Book' },
              { name: 'clmm-liquidity', desc: 'Uniswap & PancakeSwap CLMM' },
              { name: 'kuru-swap', desc: 'Kuru Flow aggregator swaps' },
              { name: 'kuru-liquidity', desc: 'Kuru AMM Vault deposits' },
              { name: 'security-hardening', desc: 'Security & incident response' },
            ].map((skill) => (
              <a
                key={skill.name}
                href={`https://github.com/Monadly/OpenClaw/blob/main/skills/${skill.name}_SKILL.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
              >
                <p className="text-xs font-medium text-white/80">{skill.name}</p>
                <p className="text-[10px] text-white/35 mt-0.5">{skill.desc}</p>
              </a>
            ))}
          </div>

          {/* Step 1: Download */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-full bg-monad-purple/20 flex items-center justify-center text-[10px] font-bold text-monad-purple-light">1</div>
              <span className="text-xs font-medium text-white/70">Download skills to your machine</span>
            </div>
            <div className="rounded-lg bg-black/30 border border-white/10 p-3">
              <p className="text-[11px] text-white/50 mb-2">
                Tell your OpenClaw agent:
              </p>
              <div className="flex items-start gap-2">
                <code className="flex-1 text-[11px] text-monad-cyan bg-black/40 px-3 py-2 rounded-lg overflow-x-auto whitespace-nowrap">
                  {skillsDownloadCmd}
                </code>
                <button
                  onClick={copyDownloadCmd}
                  className="shrink-0 h-8 px-3 rounded-lg bg-monad-cyan/20 hover:bg-monad-cyan/30 text-monad-cyan text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  {copiedDownload ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedDownload ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2: Register */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-full bg-monad-purple/20 flex items-center justify-center text-[10px] font-bold text-monad-purple-light">2</div>
            <span className="text-xs font-medium text-white/70">Register skills with OpenClaw</span>
          </div>
          <div className="rounded-lg bg-black/30 border border-white/10 overflow-hidden">
            {/* Tab Headers */}
            <div className="flex border-b border-white/10">
              <button
                onClick={() => setSkillsTab('natural')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors',
                  skillsTab === 'natural'
                    ? 'text-monad-cyan bg-monad-cyan/10 border-b-2 border-monad-cyan -mb-px'
                    : 'text-white/50 hover:text-white/70'
                )}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Natural Language
              </button>
              <button
                onClick={() => setSkillsTab('cli')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors',
                  skillsTab === 'cli'
                    ? 'text-monad-cyan bg-monad-cyan/10 border-b-2 border-monad-cyan -mb-px'
                    : 'text-white/50 hover:text-white/70'
                )}
              >
                <Terminal className="w-3.5 h-3.5" />
                CLI Command
              </button>
              <button
                onClick={() => setSkillsTab('json')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors',
                  skillsTab === 'json'
                    ? 'text-monad-cyan bg-monad-cyan/10 border-b-2 border-monad-cyan -mb-px'
                    : 'text-white/50 hover:text-white/70'
                )}
              >
                <FileJson className="w-3.5 h-3.5" />
                JSON Config
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-3">
              {skillsTab === 'natural' ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/50">Just tell your OpenClaw:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs text-monad-cyan bg-black/40 px-3 py-2 rounded-lg">
                      {skillsNaturalCmd}
                    </code>
                    <button
                      onClick={() => copySkillsCmd(skillsNaturalCmd)}
                      className="shrink-0 h-8 px-3 rounded-lg bg-monad-cyan/20 hover:bg-monad-cyan/30 text-monad-cyan text-xs font-medium transition-colors flex items-center gap-1.5"
                    >
                      {copiedSkillsCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSkillsCmd ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[10px] text-white/30">
                    OpenClaw will automatically update its config to discover skills in that directory
                  </p>
                </div>
              ) : skillsTab === 'cli' ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/50">Run this in your terminal:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs text-monad-cyan bg-black/40 px-3 py-2 rounded-lg overflow-x-auto whitespace-nowrap">
                      {skillsCliCmd}
                    </code>
                    <button
                      onClick={() => copySkillsCmd(skillsCliCmd)}
                      className="shrink-0 h-8 px-3 rounded-lg bg-monad-cyan/20 hover:bg-monad-cyan/30 text-monad-cyan text-xs font-medium transition-colors flex items-center gap-1.5"
                    >
                      {copiedSkillsCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSkillsCmd ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[10px] text-white/30">
                    This registers ~/.openclaw/skills/ as an extra skills directory
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/50">Add this to ~/.openclaw/openclaw.json:</p>
                  <pre className="text-xs text-monad-cyan bg-black/40 px-3 py-2 rounded-lg overflow-x-auto">
                    {skillsJsonSnippet}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 text-[11px] text-white/30 leading-relaxed">
            Skills are installed to <code className="text-monad-cyan/60">~/.openclaw/skills/</code>.
            Each skill teaches OpenClaw a specific capability — from safety checks to liquidity management.
          </p>
        </GlassCard>
      </div>

      {/* Setup Guide */}
      <div className="mt-6">
        <GlassCard accentColor="#6e54ff" className="overflow-visible">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(110, 84, 255, 0.2)', border: '1px solid rgba(110, 84, 255, 0.3)' }}
              >
                <span className="text-base">📖</span>
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-white/95 tracking-tight">Setup Guide</h2>
                <p className="text-[11px] text-white/40">Three simple steps to get started</p>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <SetupStep
              step={1}
              title="Choose Transport"
              description={
                <span>
                  Select <strong className="text-white/70">Tailscale Direct</strong> for maximum security or{' '}
                  <strong className="text-white/70">Telegram</strong> for the easiest setup.
                </span>
              }
              done={true}
            />
            <SetupStep
              step={2}
              title="Configure Credentials"
              description={
                config.transport === 'tailscale' ? (
                  <span>
                    Generate a token, configure it on OpenClaw, and enter your Tailscale URL above.
                  </span>
                ) : (
                  <span>
                    Enter your Telegram bot token and chat ID above.
                  </span>
                )
              }
              done={config.configured}
            />
            <SetupStep
              step={3}
              title="Test Connection"
              description="Click Test Connection above to verify everything works. Check Telegram for the response."
              done={false}
            />
          </div>

          {/* CLI command for Tailscale setup */}
          {config.transport === 'tailscale' && config.openclawToken && (
            <div className="mt-4 rounded-lg bg-black/30 border border-white/10 overflow-hidden">
              <div className="flex border-b border-white/10">
                <button
                  onClick={() => setConfigTab('cli')}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors',
                    configTab === 'cli'
                      ? 'text-monad-cyan bg-monad-cyan/10 border-b-2 border-monad-cyan -mb-px'
                      : 'text-white/50 hover:text-white/70'
                  )}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Terminal Command
                </button>
                <button
                  onClick={() => setConfigTab('json')}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors',
                    configTab === 'json'
                      ? 'text-monad-cyan bg-monad-cyan/10 border-b-2 border-monad-cyan -mb-px'
                      : 'text-white/50 hover:text-white/70'
                  )}
                >
                  <FileJson className="w-3.5 h-3.5" />
                  JSON Config
                </button>
              </div>

              <div className="p-3">
                {configTab === 'cli' ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-white/50">
                      Run this command in your OpenClaw terminal:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs text-monad-cyan bg-black/40 px-3 py-2 rounded-lg overflow-x-auto whitespace-nowrap">
                        {cliCommandMasked}
                      </code>
                      <button
                        onClick={copyCommand}
                        className="shrink-0 h-8 px-3 rounded-lg bg-monad-cyan/20 hover:bg-monad-cyan/30 text-monad-cyan text-xs font-medium transition-colors flex items-center gap-1.5"
                      >
                        {copiedCommand ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedCommand ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[10px] text-white/30">
                      This will automatically update your ~/.openclaw/openclaw.json
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-white/50">
                      Or manually add this to ~/.openclaw/openclaw.json:
                    </p>
                    <pre className="text-xs text-monad-cyan bg-black/40 px-3 py-2 rounded-lg overflow-x-auto">
{`{
  "hooks": {
    "token": "${showToken ? config.openclawToken : '\u2022'.repeat(22)}"
  }
}`}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </main>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface GlassCardProps {
  children: React.ReactNode;
  accentColor: string;
  className?: string;
}

function GlassCard({ children, accentColor, className }: GlassCardProps) {
  return (
    <div
      className={cn(
        'relative rounded-xl p-4 sm:p-5 border border-monad-purple/20 hover:border-monad-purple/30 transition-all duration-300',
        className
      )}
      style={{
        background: '#0e091c',
      }}
    >
      <div
        className="absolute inset-0 rounded-xl blur-xl opacity-30 -z-10"
        style={{
          background: `linear-gradient(to bottom right, ${accentColor}33, ${accentColor}1A, transparent)`,
        }}
      />
      <div
        className="absolute top-0 left-1.5 right-0 h-[2px] opacity-80 rounded-t-xl"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}

interface TransportCardProps {
  transport: Transport;
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  badge: string;
  description: string;
  onSelect: () => void;
  accentColor: string;
  disabled?: boolean;
}

function TransportCard({ selected, icon, title, badge, description, onSelect, accentColor, disabled }: TransportCardProps) {
  return (
    <button
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={cn(
        'relative flex flex-col items-start gap-2 p-4 rounded-xl border transition-all text-left',
        disabled
          ? 'border-white/5 bg-white/[0.01] opacity-50 cursor-not-allowed'
          : selected
            ? 'border-2'
            : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
      )}
      style={selected && !disabled ? {
        borderColor: `${accentColor}60`,
        background: `linear-gradient(135deg, ${accentColor}12 0%, ${accentColor}05 100%)`,
        boxShadow: `0 0 24px ${accentColor}15`,
      } : undefined}
    >
      <div className="flex items-center gap-3 w-full">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: selected && !disabled ? `${accentColor}25` : 'rgba(255,255,255,0.06)',
            color: selected && !disabled ? accentColor : 'rgba(255,255,255,0.5)',
          }}
        >
          {icon}
        </div>
        <div className="flex-1">
          <span className={cn('text-sm font-semibold', selected && !disabled ? 'text-white' : 'text-white/70')}>{title}</span>
        </div>
        <span
          className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
          style={{
            background: selected && !disabled ? `${accentColor}20` : 'rgba(255,255,255,0.06)',
            color: selected && !disabled ? accentColor : 'rgba(255,255,255,0.4)',
            border: `1px solid ${selected && !disabled ? `${accentColor}30` : 'rgba(255,255,255,0.1)'}`,
          }}
        >
          {badge}
        </span>
      </div>
      <p className="text-[11px] text-white/40 leading-relaxed">{description}</p>
    </button>
  );
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}

function ActionButton({ icon, label, color, onClick, disabled }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex flex-col items-center gap-2 py-4 px-3 rounded-xl transition-all duration-200',
        'border hover:scale-[1.02] active:scale-[0.98]',
        disabled && 'opacity-40 cursor-not-allowed hover:scale-100'
      )}
      style={{
        background: disabled ? 'rgba(255,255,255,0.03)' : `linear-gradient(135deg, ${color}15 0%, ${color}08 100%)`,
        borderColor: disabled ? 'rgba(255,255,255,0.1)' : `${color}30`,
        boxShadow: disabled ? 'none' : `0 0 20px ${color}15`,
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
        style={{
          background: `${color}20`,
          color: disabled ? 'rgba(255,255,255,0.3)' : color,
        }}
      >
        {icon}
      </div>
      <span
        className="text-xs font-medium"
        style={{ color: disabled ? 'rgba(255,255,255,0.3)' : color }}
      >
        {label}
      </span>
    </button>
  );
}

interface SetupStepProps {
  step: number;
  title: string;
  description: React.ReactNode;
  done?: boolean;
}

function SetupStep({ step, title, description, done }: SetupStepProps) {
  return (
    <div className={cn(
      'relative p-4 rounded-lg border transition-all',
      done
        ? 'bg-green-500/5 border-green-500/20'
        : 'bg-white/[0.02] border-white/10'
    )}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
          done
            ? 'bg-green-500/20 text-green-400'
            : 'bg-monad-purple/20 text-monad-purple-light'
        )}>
          {done ? <Check className="w-3.5 h-3.5" /> : step}
        </div>
        <h3 className="text-sm font-medium text-white/90">{title}</h3>
      </div>
      <p className="text-[11px] text-white/50 leading-relaxed pl-9">{description}</p>
    </div>
  );
}
