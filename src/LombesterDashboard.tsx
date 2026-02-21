/**
 * @file Lobster Command Center — OpenClaw's multi-pool liquidity management dashboard.
 *
 * This is the primary user interface for configuring and dispatching OpenClaw commands.
 * It renders above the pool table when at least 1 pool checkbox is selected.
 *
 * ARCHITECTURE
 * ────────────
 * The dashboard doesn't execute on-chain transactions directly. Instead, it:
 * 1. Collects strategy parameters from UI controls (range, capital, distribution, etc.)
 * 2. Builds a structured natural-language message via `buildDeployMessage()`
 * 3. Sends that message to the OpenClaw bot (via Tailscale or Telegram)
 * 4. The bot's AI agent parses the message and executes using SKILL.md instructions
 *
 * TWO MODES
 * ─────────
 * - **Strategy (Dynamic)**: Autonomous management — bot continuously monitors top N pools,
 *   rotates positions when rankings change, rebalances on schedule.
 * - **Manual (One-shot)**: Single deployment — user picks specific pools, bot deploys once.
 *
 * SETTINGS PERSISTENCE
 * ────────────────────
 * Most settings use `usePersistedState` (localStorage) so they survive page reloads.
 * Per-pool ranges and allocations use local `useState` since they're pool-specific.
 *
 * @see {@link ../skills/monadly-core_SKILL.md} — Strategy Activation Flow (how the bot parses these messages)
 * @see {@link ./settings-page.tsx} — OpenClaw settings (Telegram config, transport selection)
 * @see {@link ./useBotCommand.ts} — Message transport layer (Tailscale/Telegram)
 */
'use client';

import { useState, useCallback, useMemo, useRef, forwardRef, useEffect } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import Image from '@/platform/image';
import Link from '@/platform/link';
import { Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useBotCommand } from '@/hooks/useBotCommand';
import { useChain } from '@/context/BrandContext';
import { phTrackLobsterSend, phTrackLobsterCopy } from '@/lib/posthog/events';
import { GlassBanner } from '@/components/ui/GlassBanner';
import { TokenPairLogo } from '@/components/TokenLogo';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { DEX_CONFIG, type DexType } from '@/types/pool';
import { cn } from '@/lib/utils';
import type { PoolTableRowData } from '@/components/pool-table/types';

/** OpenClaw brand color — lobster orange. Used for all accent styling in the dashboard. */
const LOBSTER_COLOR = '#FF6B35';

/** Format a token price for display in range labels (compact, human-readable). */
const formatPrice = (price: number) => {
  if (price === 0) return '-';
  if (price >= 1000) return `$${(price / 1000).toFixed(1)}k`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(4)}`;
};

/**
 * DEXes without a corresponding liquidity SKILL.md file.
 * Pools from these DEXes are shown with an "Unsupported" badge and excluded from
 * deployment messages, allocation calculations, and strategy rotation.
 */
export const UNSUPPORTED_DEXES: ReadonlySet<string> = new Set(['Curve']);

/**
 * Kuru pools are ERC20 vaults with auto-managed spread (not concentrated liquidity).
 * They don't use range controls — the vault manages its own bid/ask spread on the CLOB.
 * When detected, range sliders are replaced with a "Vault" badge in the pool list.
 */
const isVaultPool = (pool: PoolTableRowData) => pool.protocolName.toLowerCase() === 'kuru';

interface LombesterDashboardProps {
  /** Set of selected pool IDs */
  selectedPoolIds: Set<string>;
  /** Callback to close/dismiss the dashboard */
  onClose: () => void;
  /** All pools (to get details for selected items) */
  pools: PoolTableRowData[];
  /** Callback to select top N pools from sorted table */
  onSelectTopPools?: (count: number) => void;
  /** Callback to change sort column (APR or Real Return) */
  onSortChange?: (sortKey: 'combinedAPR' | 'normalizedBestlyReturn') => void;
}

// Epoch-end behavior options
type EpochEndBehavior = 'withdraw' | 'redeploy' | 'remain';

// ============================================================================
// Range Slider Component (reused from OpenClawRowContent)
// ============================================================================

interface RangeSliderProps {
  minPercent: number;
  maxPercent: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
  accentColor: string;
  disabled?: boolean;
  neon?: boolean;
}

function RangeSlider({ minPercent, maxPercent, onMinChange, onMaxChange, accentColor, disabled, neon }: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);

  const percentToPos = (percent: number) => {
    if (percent <= 0) return 50 + (percent / 2);
    return Math.min(100, 50 + percent / 2);
  };
  const posToPercent = (pos: number) => (pos - 50) * 2;

  const minPos = percentToPos(minPercent);
  const maxPos = percentToPos(maxPercent);

  const handlePointerDown = (handle: 'min' | 'max') => (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(handle);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !trackRef.current || disabled) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = trackRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const percent = Math.round(posToPercent(pos));

    if (dragging === 'min') {
      const clampedPercent = Math.max(-99, Math.min(0, percent));
      onMinChange(clampedPercent);
    } else {
      const clampedPercent = Math.max(0, percent);
      onMaxChange(clampedPercent);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragging) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setDragging(null);
    }
  };

  // Greyed out handle color when disabled
  const handleColor = disabled ? 'rgba(255,255,255,0.3)' : accentColor;

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative h-6 flex items-center select-none touch-none',
        disabled && 'pointer-events-none'
      )}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Track background */}
      <div className={cn(
        'absolute inset-x-0 h-1 rounded-full',
        disabled ? 'bg-white/5' : 'bg-white/10'
      )} />

      {/* Active range */}
      <div
        className="absolute h-1.5 rounded-full"
        style={{
          left: `${minPos}%`,
          width: `${maxPos - minPos}%`,
          background: neon
            ? `linear-gradient(90deg, ${accentColor}, ${accentColor})`
            : disabled
              ? 'rgba(255,255,255,0.12)'
              : `linear-gradient(90deg, ${accentColor}60, ${accentColor}90)`,
          boxShadow: neon ? `0 0 8px ${accentColor}, 0 0 16px ${accentColor}60` : undefined,
        }}
      />

      {/* Center marker (current price) */}
      <div
        className={cn(
          'absolute w-px h-3 pointer-events-none',
          disabled ? 'bg-white/20' : 'bg-white/40'
        )}
        style={{ left: '50%', transform: 'translateX(-50%)' }}
      />

      {/* Min handle */}
      <div
        onPointerDown={handlePointerDown('min')}
        className={cn(
          'absolute w-3.5 h-3.5 rounded-full border-2 z-10',
          disabled ? 'bg-monad-navy/50' : 'bg-monad-navy',
          !disabled && 'cursor-grab',
          dragging === 'min' && 'cursor-grabbing scale-110'
        )}
        style={{
          left: `${minPos}%`,
          transform: 'translateX(-50%)',
          borderColor: handleColor,
          boxShadow: neon ? `0 0 6px ${accentColor}` : undefined,
        }}
      />

      {/* Max handle */}
      <div
        onPointerDown={handlePointerDown('max')}
        className={cn(
          'absolute w-3.5 h-3.5 rounded-full border-2 z-10',
          disabled ? 'bg-monad-navy/50' : 'bg-monad-navy',
          !disabled && 'cursor-grab',
          dragging === 'max' && 'cursor-grabbing scale-110'
        )}
        style={{
          left: `${maxPos}%`,
          transform: 'translateX(-50%)',
          borderColor: handleColor,
          boxShadow: neon ? `0 0 6px ${accentColor}` : undefined,
        }}
      />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export const LombesterDashboard = forwardRef<HTMLDivElement, LombesterDashboardProps>(function LombesterDashboard({
  selectedPoolIds,
  onClose,
  pools,
  onSelectTopPools,
  onSortChange,
}, ref) {
  // Get selected pools, filtering out unsupported DEXes
  const selectedPools = useMemo(
    () => pools.filter(p => selectedPoolIds.has(p.id) && !UNSUPPORTED_DEXES.has(p.protocolName)),
    [pools, selectedPoolIds]
  );

  // Pools selected but unsupported (shown with "unsupported" badge, excluded from everything else)
  const unsupportedPools = useMemo(
    () => pools.filter(p => selectedPoolIds.has(p.id) && UNSUPPORTED_DEXES.has(p.protocolName)),
    [pools, selectedPoolIds]
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Strategy Configuration State
  //
  // These settings map 1:1 to fields in the monadly-core strategy config schema.
  // When the user clicks "Send Strategy", these values are serialized into a
  // natural-language message that the bot's AI agent parses and executes.
  //
  // @see monadly-core_SKILL.md → "Strategy Config Schema" for the full mapping
  // ─────────────────────────────────────────────────────────────────────────────
  const [poolCount, setPoolCount] = useState(() => Math.max(1, selectedPoolIds.size));

  // Keep slider in sync when pools are added/removed externally (e.g. via 🦞 click)
  useEffect(() => {
    if (selectedPoolIds.size > 0) {
      setPoolCount(selectedPoolIds.size);
    }
  }, [selectedPoolIds.size]);
  const [rangeMode, setRangeMode] = usePersistedState<'same' | 'custom'>('lobster-range-mode', 'same');
  const [balanceMode, setBalanceMode] = usePersistedState<'all' | 'fixed'>('lobster-balance-mode', 'all');
  const [fixedAmount, setFixedAmount] = usePersistedState('lobster-fixed-amount', '1000');
  const [distributionMode, setDistributionMode] = usePersistedState<'equal' | 'custom'>('lobster-distribution', 'equal');
  const [metricDisplay, setMetricDisplay] = usePersistedState<'apr' | 'realReturn'>('lobster-metric', 'realReturn');

  // Selection mode: manual pick vs auto-top-N dynamic
  const [selectionMode, setSelectionMode] = usePersistedState<'manual' | 'dynamic'>('lobster-selection-mode', 'dynamic');

  // Imported from OpenClawRowContent as GLOBAL settings for all pools
  const [positionMode, setPositionMode] = usePersistedState<'percent' | 'fixed'>('lobster-position-mode', 'percent');
  const [rangeDynamic, setRangeDynamic] = usePersistedState<'fixed' | 'follow'>('lobster-range-dynamic', 'follow');
  const [rebalanceFreq, setRebalanceFreq] = usePersistedState<'every-check' | 'out-of-range'>('lobster-rebalance-freq', 'out-of-range');

  // Central range (used when rangeMode === 'same')
  const [centralMinPercent, setCentralMinPercent] = usePersistedState('lobster-central-min', -50);
  const [centralMaxPercent, setCentralMaxPercent] = usePersistedState('lobster-central-max', 50);

  // Per-pool ranges (used when rangeMode === 'custom')
  const [poolRanges, setPoolRanges] = useState<Record<string, { min: number; max: number }>>({});

  const getPoolRange = useCallback((poolId: string) => {
    return poolRanges[poolId] || { min: -50, max: 50 };
  }, [poolRanges]);

  const setPoolRange = useCallback((poolId: string, min: number, max: number) => {
    setPoolRanges(prev => ({ ...prev, [poolId]: { min, max } }));
  }, []);

  // Per-pool allocation percentages (used when distributionMode === 'custom')
  const [poolAllocations, setPoolAllocations] = useState<Record<string, number>>({});

  const getPoolAllocation = useCallback((poolId: string) => {
    if (distributionMode === 'equal') {
      return selectedPools.length > 0 ? Math.floor(100 / selectedPools.length) : 0;
    }
    return poolAllocations[poolId] ?? Math.floor(100 / Math.max(1, selectedPools.length));
  }, [distributionMode, selectedPools.length, poolAllocations]);

  const setPoolAllocation = useCallback((poolId: string, value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setPoolAllocations(prev => ({ ...prev, [poolId]: clamped }));
  }, []);

  // Global epoch-end behavior (applies to all pools)
  const [epochBehavior, setEpochBehavior] = usePersistedState<EpochEndBehavior>('lobster-epoch-behavior', 'remain');

  // Strategy mode settings (visible when selectionMode === 'dynamic')
  const [checkInterval, setCheckInterval] = usePersistedState('lobster-check-interval', '10'); // always stored as minutes
  const [isCustomInterval, setIsCustomInterval] = useState(false); // true = user is typing in custom input
  const [statusDismissed, setStatusDismissed] = useState(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('lobster-status-dismissed') === '1';
    return false;
  });
  const [intervalUnit, setIntervalUnit] = useState<'m' | 'h'>('m');
  const [statusReports, setStatusReports] = usePersistedState<'every-cycle' | 'actions-only'>('lobster-status-reports', 'every-cycle');

  const { sendRawMessage, isLoading: isSendingCommand, connectionStatus, statusDetail } = useBotCommand();
  const { chainId, chainName } = useChain();

  // ─────────────────────────────────────────────────────────────────────────────
  // Format Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  const formatPercent = useCallback((value: number | null) => {
    if (value === null) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Message Builder & Command Dispatch
  //
  // The core output of this dashboard. `buildDeployMessage()` serializes all UI
  // settings into the exact message format that monadly-core expects to parse.
  // Two delivery methods: "Send" dispatches via the configured transport (Tailscale
  // or Telegram), "Copy" puts the message on the clipboard for manual pasting.
  // ─────────────────────────────────────────────────────────────────────────────

  /** Whether current settings represent a strategy (dynamic mode) vs one-shot deploy */
  const isStrategyMode = selectionMode === 'dynamic';

  /**
   * Serialize all dashboard settings into a natural-language command message.
   *
   * Strategy mode produces: "OpenClaw, start auto-managing my liquidity..."
   * Manual mode produces: "OpenClaw, deploy $X across N selected pools..."
   *
   * The message includes pool addresses, ranges, fee tiers, and all config —
   * everything the bot needs to execute without asking follow-up questions.
   */
  const buildDeployMessage = useCallback(() => {
    const totalPools = selectedPools.length;
    const amountText = balanceMode === 'all' ? 'my entire wallet balance' : `$${fixedAmount}`;
    const distributionText = distributionMode === 'equal' ? 'equally distributed' : 'with custom allocation weights';
    const epochText = epochBehavior === 'withdraw' ? 'withdraw and keep aside'
      : epochBehavior === 'redeploy' ? 'use liquidity on other pools'
      : 'remain in the pool';
    const sortedBy = metricDisplay === 'apr' ? 'APR' : 'Real Return';
    const positionText = positionMode === 'percent' ? 'Range %' : 'Token Value';
    const rangeTypeText = rangeDynamic === 'fixed' ? 'Fixed' : 'Follow Price (Dynamic)';
    const rangeModeText = rangeMode === 'same'
      ? `${centralMinPercent}% to +${centralMaxPercent}% from active bin (unified for all)`
      : 'individual custom ranges per pool';

    // ── Strategy format (dynamic mode — autonomous management) ──
    if (isStrategyMode) {
      const rebalanceTriggerText = rangeDynamic === 'fixed'
        ? 'None (fixed ranges)'
        : rebalanceFreq === 'every-check' ? 'Every check' : 'When out of range';
      const mins = Number(checkInterval);
      const intervalText = mins >= 60 && mins % 60 === 0
        ? `${mins / 60} hour${mins / 60 === 1 ? '' : 's'}`
        : `${mins} minutes`;
      const statusText = statusReports === 'every-cycle' ? 'Every interval' : 'When taking action';

      let message = `OpenClaw, start auto-managing my liquidity.

Strategy: Top ${totalPools} pools by ${sortedBy} (Bestly Score)
Capital: ${amountText}, ${distributionText}
Position mode: ${positionText}
Range: ${rangeModeText}
Range type: ${rangeTypeText}
Check interval: Every ${intervalText}
Rebalance trigger: ${rebalanceTriggerText}
Pool rotation: Yes, when pool drops out of Top ${totalPools}
Epoch behavior: ${epochText.charAt(0).toUpperCase() + epochText.slice(1)}
Status reports: ${statusText} via Telegram

Chain: ${chainName} (chainId: ${chainId})
Data source: https://monadly.xyz/openclaw.txt

Currently the top pools are:
`;

      selectedPools.forEach((pool, index) => {
        const isKuruVault = isVaultPool(pool);
        const poolRange = rangeMode === 'same'
          ? { min: centralMinPercent, max: centralMaxPercent }
          : getPoolRange(pool.id);
        const poolVersion = pool.clmmVersion ? ` ${pool.clmmVersion.toUpperCase()}` : '';
        const allocationPct = getPoolAllocation(pool.id);
        message += `${index + 1}. ${pool.poolPair} on ${pool.protocolName}${poolVersion} — ${metricDisplay === 'apr' ? `${pool.combinedAPR?.toFixed(0) ?? 'N/A'}% APR` : formatPercent(pool.normalizedBestlyReturn)}
   Allocation: ${allocationPct}% of capital
   Pool Address: ${pool.poolAddress}
   ${isKuruVault ? 'Type: Vault (auto-managed spread, no range needed)' : `Range: ${poolRange.min}% to +${poolRange.max}%`}
   Fee Tier: ${pool.feePercent}% | TVL: $${pool.tvl?.toLocaleString() ?? 'N/A'} | APR: ${pool.combinedAPR?.toFixed(2) ?? 'N/A'}%
`;
      });

      // Token address legend (deduplicated)
      const tokenMap = new Map<string, string>();
      selectedPools.forEach(pool => {
        if (pool.tokenXAddress) tokenMap.set(pool.tokenXSymbol, pool.tokenXAddress);
        if (pool.tokenYAddress) tokenMap.set(pool.tokenYSymbol, pool.tokenYAddress);
      });
      if (tokenMap.size > 0) {
        message += `\nToken Addresses:\n`;
        tokenMap.forEach((address, symbol) => {
          message += `- ${symbol}: ${address}\n`;
        });
      }

      message += `\nSkills: Use /monadly-core for safety checks, then the appropriate DEX skill for execution.\nVerify all addresses against each skill's SKILL.md (Contract Addresses section) before transacting.`;
      return message;
    }

    // ── One-shot deploy format (manual mode) ──
    const rangeText = rangeMode === 'same'
      ? `using a unified range of ${centralMinPercent}% to +${centralMaxPercent}% for all pools`
      : 'with individual custom ranges per pool';
    const rebalanceText = rangeDynamic === 'follow'
      ? `\n- Rebalance: ${rebalanceFreq === 'every-check' ? 'every check' : 'when out of range'}`
      : '';

    let message = `OpenClaw, deploy ${amountText} across ${totalPools} manually selected pools, ${distributionText}, ${rangeText}. At epoch end, ${epochText}.

Chain: ${chainName} (chainId: ${chainId})

Position Settings:
- Mode: ${positionText}
- Range Type: ${rangeTypeText}${rebalanceText}
`;

    message += `\nPool Deployment Details:\n`;

    selectedPools.forEach((pool, index) => {
      const isKuruVault = isVaultPool(pool);
      const poolRange = rangeMode === 'same'
        ? { min: centralMinPercent, max: centralMaxPercent }
        : getPoolRange(pool.id);

      const allocationPct = getPoolAllocation(pool.id);
      const share = distributionMode === 'equal'
        ? `1/${totalPools} of ${balanceMode === 'all' ? 'wallet balance' : `$${fixedAmount}`}`
        : `${allocationPct}% of ${balanceMode === 'all' ? 'wallet balance' : `$${fixedAmount}`}`;

      let rangeLines: string;
      if (isKuruVault) {
        rangeLines = '   Type: Vault (auto-managed spread, no range needed)';
      } else {
        let priceRangeText = '';
        if (pool.priceX) {
          const lowerPrice = pool.priceX * (1 + poolRange.min / 100);
          const upperPrice = pool.priceX * (1 + poolRange.max / 100);
          const fmtPrice = (p: number) => p >= 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(4)}`;
          priceRangeText = `\n   Price Range: ${fmtPrice(lowerPrice)} - ${fmtPrice(upperPrice)}`;
        }
        rangeLines = `   Range: ${poolRange.min}% to +${poolRange.max}%${priceRangeText}`;
      }

      const poolVersion = pool.clmmVersion ? ` ${pool.clmmVersion.toUpperCase()}` : '';
      message += `
${index + 1}. ${pool.poolPair} on ${pool.protocolName}${poolVersion}
   Deploy: ${share}
${rangeLines}
   Pool Address: ${pool.poolAddress}
   Fee Tier: ${pool.feePercent}%
   Current TVL: $${pool.tvl?.toLocaleString() ?? 'N/A'}
   APR: ${pool.combinedAPR?.toFixed(2) ?? 'N/A'}%
`;
    });

    // Token address legend (deduplicated)
    const tokenMap = new Map<string, string>();
    selectedPools.forEach(pool => {
      if (pool.tokenXAddress) tokenMap.set(pool.tokenXSymbol, pool.tokenXAddress);
      if (pool.tokenYAddress) tokenMap.set(pool.tokenYSymbol, pool.tokenYAddress);
    });
    if (tokenMap.size > 0) {
      message += `\nToken Addresses:\n`;
      tokenMap.forEach((address, symbol) => {
        message += `- ${symbol}: ${address}\n`;
      });
    }

    message += `\nSkills: Use /monadly-core for safety checks, then the appropriate DEX skill for execution.\nVerify all addresses against each skill's SKILL.md (Contract Addresses section) before transacting.`;

    return message;
  }, [selectedPools, balanceMode, fixedAmount, distributionMode, rangeMode, centralMinPercent, centralMaxPercent, epochBehavior, metricDisplay, positionMode, rangeDynamic, rebalanceFreq, getPoolRange, getPoolAllocation, isStrategyMode, checkInterval, statusReports, formatPercent, chainId, chainName]);

  const handleSendToOpenClaw = useCallback(() => {
    if (connectionStatus === 'unconfigured') {
      toast.error(statusDetail || 'No transport configured — set up Tailscale or Telegram in OpenClaw Settings.');
      window.location.href = '/openclaw/settings';
      return;
    }
    const message = buildDeployMessage();
    sendRawMessage(message);
    phTrackLobsterSend({ poolCount: selectedPools.length, mode: isStrategyMode ? 'strategy' : 'manual' });
  }, [buildDeployMessage, sendRawMessage, selectedPools.length, isStrategyMode, connectionStatus, statusDetail]);

  const handleCopyMessage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildDeployMessage());
      toast.success('Full message copied to clipboard!');
      phTrackLobsterCopy(selectedPools.length);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [buildDeployMessage, selectedPools.length]);


  return (
    <GlassBanner ref={ref} accentColor={LOBSTER_COLOR} padding="compact" className="@container">
      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center mb-4">
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-xl">🦞</span>
          <h2 className="text-xl font-bold text-white">Lobster Command Center</h2>
          <span className="text-xl">🦞</span>
        </div>
        <div className="flex-1 flex items-center justify-end gap-2">
          <Link
            href="/openclaw"
            className="h-8 px-3 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.97] border hover:brightness-110 inline-flex items-center gap-1.5"
            style={{
              backgroundColor: `${LOBSTER_COLOR}15`,
              borderColor: `${LOBSTER_COLOR}30`,
              color: LOBSTER_COLOR,
            }}
          >
            About
          </Link>
          <Link
            href="/openclaw/settings"
            className="h-8 px-3 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.97] border hover:brightness-110 inline-flex items-center gap-1.5"
            style={{
              backgroundColor: `${LOBSTER_COLOR}15`,
              borderColor: `${LOBSTER_COLOR}30`,
              color: LOBSTER_COLOR,
            }}
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:opacity-80 transition-all"
            style={{
              backgroundColor: `${LOBSTER_COLOR}15`,
              border: `1px solid ${LOBSTER_COLOR}40`,
              color: LOBSTER_COLOR,
            }}
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-label="Close" role="img">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MAIN CONTROLS ROW
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap @7xl:flex-nowrap items-start gap-6">
        {/* Deploy Liquidity Column */}
        <div className="flex flex-col gap-1.5 items-center shrink-0">
            <span className="text-xs font-semibold text-white/70">Deploy Liquidity</span>

            {/* Dynamic / Manual Toggle */}
            <div className="flex items-center p-0.5 glass rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setSelectionMode('dynamic');
                  onSelectTopPools?.(poolCount);
                }}
                className={cn(
                  'h-7 px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                  selectionMode === 'dynamic' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                )}
                style={selectionMode === 'dynamic' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
              >
                Dynamic Top Pools
              </button>
              <button
                type="button"
                onClick={() => setSelectionMode('manual')}
                className={cn(
                  'h-7 px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                  selectionMode === 'manual' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                )}
                style={selectionMode === 'manual' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
              >
                Manual Selection
              </button>
            </div>

            {/* Pool Count Slider */}
            <div className="flex flex-col items-center w-32">
              <span className="text-xs text-white/60 mb-2">
                {selectionMode === 'manual'
                  ? `${poolCount} selected ${poolCount === 1 ? 'pool' : 'pools'}`
                  : `Top ${poolCount} ${poolCount === 1 ? 'pool' : 'pools'}`
                }
              </span>
              <Slider
                value={[poolCount]}
                onValueChange={(value) => {
                  const count = value[0];
                  setPoolCount(count);
                  if (selectionMode === 'dynamic') {
                    onSelectTopPools?.(count);
                  }
                }}
                min={1}
                max={10}
                step={1}
                className="w-full [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-[#FF6B35] [&_[data-slot=slider-thumb]]:border-[#FF6B35] [&_[data-slot=slider-thumb]]:bg-monad-navy [&_[data-slot=slider-thumb]]:shadow-[0_0_8px_#FF6B3560] [&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-thumb]]:focus-visible:ring-0"
              />
              <div className="flex justify-between w-full text-[11px] text-white/40 mt-1">
                <span>1</span>
                <span>10</span>
              </div>
            </div>

            {/* Sorted By label — greyed out in manual mode */}
            <span className={cn('text-xs mt-1', selectionMode === 'manual' ? 'text-white/25' : 'text-white/50')}>Sorted by</span>

            {/* Metric Display Toggle — disabled in manual mode */}
            <div className={cn('flex items-center p-0.5 glass rounded-lg', selectionMode === 'manual' && 'opacity-40 pointer-events-none')}>
              <button
                type="button"
                onClick={() => {
                  setMetricDisplay('realReturn');
                  onSortChange?.('normalizedBestlyReturn');
                }}
                className={cn(
                  'h-7 min-w-[70px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                  metricDisplay === 'realReturn' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                )}
                style={metricDisplay === 'realReturn' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
              >
                Real Return
              </button>
              <button
                type="button"
                onClick={() => {
                  setMetricDisplay('apr');
                  onSortChange?.('combinedAPR');
                }}
                className={cn(
                  'h-7 min-w-[70px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                  metricDisplay === 'apr' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                )}
                style={metricDisplay === 'apr' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
              >
                APR
              </button>
            </div>
          </div>

        {/* Wallet Settings Column */}
        <div className="flex flex-col gap-1.5 items-start shrink-0">
            <span className="text-xs font-semibold text-white/70">Wallet Settings</span>

            {/* Deploy Amount */}
            <RadioGroup
              value={balanceMode}
              onValueChange={(val) => setBalanceMode(val as 'all' | 'fixed')}
              className="gap-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="all"
                  id="deploy-all"
                  className="size-3.5 border-white/30 shadow-none data-[state=checked]:border-[#FF6B35] [&_svg]:fill-[#FF6B35]"
                />
                <label
                  htmlFor="deploy-all"
                  className={cn(
                    'text-xs cursor-pointer select-none',
                    balanceMode === 'all' ? 'text-white/80' : 'text-white/50'
                  )}
                >
                  Deploy all wallet liquidity
                </label>
              </div>
              <label
                htmlFor="deploy-fixed"
                className="flex items-center gap-2 cursor-pointer"
              >
                <RadioGroupItem
                  value="fixed"
                  id="deploy-fixed"
                  className="size-3.5 border-white/30 shadow-none data-[state=checked]:border-[#FF6B35] [&_svg]:fill-[#FF6B35]"
                />
                <label
                  htmlFor="deploy-fixed"
                  className={cn(
                    'text-xs cursor-pointer select-none',
                    balanceMode === 'fixed' ? 'text-white/80' : 'text-white/50'
                  )}
                >
                  Deploy
                </label>
                <div className="flex items-center gap-0.5">
                  <span className={cn('text-xs', balanceMode === 'fixed' ? 'text-white/60' : 'text-white/30')}>$</span>
                  <Input
                    type="text"
                    value={fixedAmount}
                    onFocus={() => setBalanceMode('fixed')}
                    onChange={(e) => setFixedAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className={cn(
                      'w-14 h-6 px-1.5 rounded-md text-xs md:text-sm text-white text-center focus:outline-none focus-visible:ring-0 shadow-none transition-colors',
                      balanceMode !== 'fixed' && 'opacity-40'
                    )}
                    style={{
                      backgroundColor: `${LOBSTER_COLOR}10`,
                      border: `1px solid ${LOBSTER_COLOR}30`,
                    }}
                  />
                </div>
              </label>
            </RadioGroup>

            {/* Rebalancing Trigger — subheader styled like "Wallet Settings" */}
            <span className="text-xs font-semibold text-white/70 mt-1">Rebalancing Trigger</span>
            <RadioGroup
              value={rangeDynamic === 'fixed' ? 'none' : rebalanceFreq}
              onValueChange={(val) => {
                if (val === 'none') {
                  setRangeDynamic('fixed');
                } else {
                  setRangeDynamic('follow');
                  setRebalanceFreq(val as 'every-check' | 'out-of-range');
                }
              }}
              className="gap-1.5"
            >
              {([
                { value: 'none', label: "Don't rebalance automatically" },
                { value: 'every-check', label: 'Every check interval' },
                { value: 'out-of-range', label: 'Only when a pool is out of range' },
              ] as const).map((option) => {
                const selected = rangeDynamic === 'fixed' ? 'none' : rebalanceFreq;
                return (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem
                      value={option.value}
                      id={`rebal-${option.value}`}
                      className="size-3.5 border-white/30 shadow-none data-[state=checked]:border-[#FF6B35] [&_svg]:fill-[#FF6B35]"
                    />
                    <label
                      htmlFor={`rebal-${option.value}`}
                      className={cn(
                        'text-xs cursor-pointer select-none',
                        selected === option.value ? 'text-white/80' : 'text-white/50'
                      )}
                    >
                      {option.label}
                    </label>
                  </div>
                );
              })}
            </RadioGroup>

          </div>

        {/* Column 3: Strategy Timing + Epoch Behavior */}
        <div className="flex flex-col gap-1.5 items-start shrink-0">
            {/* Strategy controls — visible in dynamic mode */}
            {isStrategyMode && (
              <>
                <span className="text-xs font-semibold text-white/70">
                  {rebalanceFreq === 'every-check' && rangeDynamic !== 'fixed' ? 'Rebalancing Interval' : 'Check Interval'}
                </span>
                <div className="flex items-center gap-1">
                  <div className="flex items-center p-0.5 glass rounded-lg">
                    {([
                      { value: '10', label: '10m' },
                      { value: '60', label: '1h' },
                      { value: '1440', label: '24h' },
                    ] as const).map((opt) => (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => { setCheckInterval(opt.value); setIsCustomInterval(false); }}
                        className={cn(
                          'h-6 px-2 rounded-md text-[11px] font-medium transition-all duration-200 active:scale-[0.97]',
                          !isCustomInterval && checkInterval === opt.value ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                        )}
                        style={!isCustomInterval && checkInterval === opt.value ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Custom interval input + unit toggle */}
                  <div className="inline-flex items-center p-0.5 rounded-lg" style={{ border: `1px solid ${isCustomInterval ? `${LOBSTER_COLOR}40` : 'rgba(255,255,255,0.08)'}`, backgroundColor: isCustomInterval ? `${LOBSTER_COLOR}08` : 'transparent' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={isCustomInterval
                        ? (intervalUnit === 'h' ? String(Math.round(Number(checkInterval) / 60) || '') : checkInterval)
                        : ''
                      }
                      placeholder="—"
                      onFocus={() => {
                        if (!isCustomInterval) {
                          setIsCustomInterval(true);
                        }
                      }}
                      onChange={(e) => {
                        const num = e.target.value.replace(/[^0-9]/g, '');
                        if (!num) { setCheckInterval('0'); return; }
                        const val = Number(num);
                        const minutes = intervalUnit === 'h' ? val * 60 : val;
                        setCheckInterval(String(minutes));
                      }}
                      onBlur={(e) => {
                        const num = e.target.value.replace(/[^0-9]/g, '');
                        if (!num || num === '0') {
                          setCheckInterval('10');
                          setIsCustomInterval(false);
                        }
                      }}
                      className="h-6 border-0 bg-transparent rounded-md text-[11px] text-right font-medium outline-none transition-all placeholder:text-white/30"
                      style={{
                        color: isCustomInterval ? LOBSTER_COLOR : 'rgba(255,255,255,0.3)',
                        width: `${Math.max(1, (isCustomInterval ? String(intervalUnit === 'h' ? Math.round(Number(checkInterval) / 60) || '' : checkInterval).length : 1)) + 0.5}ch`,
                        paddingLeft: '0.25ch',
                        paddingRight: '0.25ch',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!isCustomInterval) {
                          setIsCustomInterval(true);
                          return;
                        }
                        setIntervalUnit(intervalUnit === 'm' ? 'h' : 'm');
                      }}
                      className="h-6 px-1 rounded-md text-[11px] font-medium transition-all duration-200 active:scale-[0.97] select-none"
                      style={{ color: isCustomInterval ? LOBSTER_COLOR : 'rgba(255,255,255,0.3)' }}
                      title={isCustomInterval ? `Switch to ${intervalUnit === 'm' ? 'hours' : 'minutes'}` : 'Set custom interval'}
                    >
                      {intervalUnit === 'm' ? 'min' : 'hours'}
                    </button>
                  </div>
                </div>

                <span className="text-xs font-semibold text-white/70 mt-1">Notify me</span>
                <div className="flex items-center p-0.5 glass rounded-lg">
                  <button
                    type="button"
                    onClick={() => setStatusReports('every-cycle')}
                    className={cn(
                      'h-6 px-2 rounded-md text-[11px] font-medium transition-all duration-200 active:scale-[0.97]',
                      statusReports === 'every-cycle' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                    )}
                    style={statusReports === 'every-cycle' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                  >
                    Every interval
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusReports('actions-only')}
                    className={cn(
                      'h-6 px-2 rounded-md text-[11px] font-medium transition-all duration-200 active:scale-[0.97]',
                      statusReports === 'actions-only' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                    )}
                    style={statusReports === 'actions-only' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                  >
                    When taking action
                  </button>
                </div>
              </>
            )}

            {/* At Epoch End — always visible */}
            <span className={cn("text-xs font-semibold text-white/70", isStrategyMode && "mt-1")}>At Epoch End</span>
            <RadioGroup
              value={epochBehavior}
              onValueChange={(val) => setEpochBehavior(val as EpochEndBehavior)}
              className="gap-1.5"
            >
              {([
                { value: 'redeploy', label: 'Use liquidity on other pools' },
                { value: 'withdraw', label: 'Withdraw and keep aside' },
                { value: 'remain', label: 'Remain in the pool' },
              ] as const).map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={option.value}
                    id={`epoch-${option.value}`}
                    className="size-3.5 border-white/30 shadow-none data-[state=checked]:border-[#FF6B35] [&_svg]:fill-[#FF6B35]"
                  />
                  <label
                    htmlFor={`epoch-${option.value}`}
                    className={cn(
                      'text-xs cursor-pointer select-none',
                      epochBehavior === option.value ? 'text-white/80' : 'text-white/50'
                    )}
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </RadioGroup>
          </div>

        {/* Divider */}
        <div className="hidden @7xl:block w-px self-stretch" style={{ backgroundColor: `${LOBSTER_COLOR}30` }} />

        {/* ─────────────────────────────────────────────────────────────────────
            Command Preview & Pool List & Buttons
            ───────────────────────────────────────────────────────────────────── */}
        {/* Column 4: Command summary */}
        <div className="@7xl:flex-1 text-xs text-white/60 leading-snug select-none space-y-0.5 min-w-0">
            {isStrategyMode ? (
              <>
                <p className="text-white/70 font-semibold">&quot;OpenClaw, start auto-managing my liquidity.</p>
                <p>Deploy <span style={{ color: LOBSTER_COLOR }}>{balanceMode === 'all' ? 'entire wallet' : `$${fixedAmount}`}</span> across top <span style={{ color: LOBSTER_COLOR }}>{selectedPools.length}</span> pools by <span style={{ color: LOBSTER_COLOR }}>{metricDisplay === 'apr' ? 'APR' : 'Real Return'}</span>, {distributionMode === 'equal' ? 'equally distributed' : 'custom allocation'}.</p>
                <p>Range: {rangeMode === 'same' ? <><span style={{ color: LOBSTER_COLOR }}>{centralMinPercent}%</span> to <span style={{ color: LOBSTER_COLOR }}>+{centralMaxPercent}%</span></> : <span style={{ color: LOBSTER_COLOR }}>Custom per-pool ranges</span>}, <span style={{ color: LOBSTER_COLOR }}>{rangeDynamic === 'fixed' ? 'fixed' : 'follow price'}</span> mode.</p>
                <p>Check every <span style={{ color: LOBSTER_COLOR }}>{(() => { const m = Number(checkInterval); return m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m} min`; })()}</span>, rebalance <span style={{ color: LOBSTER_COLOR }}>{rangeDynamic === 'fixed' ? 'never' : rebalanceFreq === 'every-check' ? 'every check' : 'when out of range'}</span>.</p>
                <p>At epoch end: <span style={{ color: LOBSTER_COLOR }}>{epochBehavior === 'withdraw' ? 'withdraw' : epochBehavior === 'redeploy' ? 'redeploy to other pools' : 'remain in pool'}</span>.</p>
                <p>Notify: <span style={{ color: LOBSTER_COLOR }}>{statusReports === 'every-cycle' ? 'every interval' : 'when taking action'}</span>.</p>
              </>
            ) : (
              <p>
                &quot;OpenClaw, deploy <span style={{ color: LOBSTER_COLOR }}>{balanceMode === 'all' ? 'my entire wallet balance' : `$${fixedAmount}`}</span> across <span style={{ color: LOBSTER_COLOR }}>{selectedPools.length}</span> selected pools, <span style={{ color: LOBSTER_COLOR }}>{distributionMode === 'equal' ? 'equally distributed' : 'with custom allocation'}</span>, using {positionMode === 'percent' ? <>{rangeMode === 'same' ? <>a <span style={{ color: LOBSTER_COLOR }}>{centralMinPercent}%</span> to <span style={{ color: LOBSTER_COLOR }}>+{centralMaxPercent}%</span> range</> : <span style={{ color: LOBSTER_COLOR }}>custom per-pool ranges</span>}</> : <>fixed $ value positions</>} with <span style={{ color: LOBSTER_COLOR }}>{rangeDynamic === 'fixed' ? 'fixed' : 'follow price'}</span> mode{rangeDynamic === 'follow' && <>, rebalancing <span style={{ color: LOBSTER_COLOR }}>{rebalanceFreq === 'every-check' ? 'every check' : 'when out of range'}</span></>}. At epoch end, <span style={{ color: LOBSTER_COLOR }}>{epochBehavior === 'withdraw' ? 'withdraw and keep aside' : epochBehavior === 'redeploy' ? 'use liquidity on other pools' : 'remain in the pool'}</span>.&quot;
              </p>
            )}

            {selectionMode === 'dynamic' ? (
              <>
                <p className="text-white/40 text-[11px]">Currently the top pools by {metricDisplay === 'apr' ? 'APR' : 'Real Return'} are:</p>
                {selectedPools.map((pool, index) => {
                  const poolRange = rangeMode === 'same'
                    ? { min: centralMinPercent, max: centralMaxPercent }
                    : getPoolRange(pool.id);
                  const allocationPct = getPoolAllocation(pool.id);
                  const isKuru = isVaultPool(pool);
                  return (
                    <p key={pool.id} className="pl-2">
                      {index + 1}. <span style={{ color: LOBSTER_COLOR }}>{pool.poolPair}</span> on <span style={{ color: LOBSTER_COLOR }}>{pool.protocolName}</span>
                      {isKuru
                        ? <> — depositing <span style={{ color: LOBSTER_COLOR }}>{allocationPct}%</span> of capital into vault (auto-managed)</>
                        : <> — deploying <span style={{ color: LOBSTER_COLOR }}>{allocationPct}%</span> of capital in a <span style={{ color: LOBSTER_COLOR }}>{poolRange.min}%</span> to <span style={{ color: LOBSTER_COLOR }}>+{poolRange.max}%</span> range from current price</>}
                    </p>
                  );
                })}
                <p className="text-white/30 text-[11px]">Source: <a href="https://monadly.xyz/openclaw.txt" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/50 transition-colors">https://monadly.xyz/openclaw.txt</a>&quot;</p>
              </>
            ) : (
              <>
                <p className="text-white/40 text-[11px]">Pool Deployment:</p>
                {selectedPools.map((pool, index) => {
                  const isKuruVault = isVaultPool(pool);
                  const poolRange = rangeMode === 'same' ? { min: centralMinPercent, max: centralMaxPercent } : getPoolRange(pool.id);
                  const allocationPct = getPoolAllocation(pool.id);
                  const shareText = distributionMode === 'equal' ? `1/${selectedPools.length}` : `${allocationPct}%`;
                  const isLast = index === selectedPools.length - 1;
                  return (
                    <p key={pool.id} className="pl-2">
                      {index + 1}. <span style={{ color: LOBSTER_COLOR }}>{pool.poolPair}</span> on <span style={{ color: LOBSTER_COLOR }}>{pool.protocolName}</span>
                      {isKuruVault
                        ? <> — depositing <span style={{ color: LOBSTER_COLOR }}>{shareText}</span> of capital into vault (auto-managed)</>
                        : <> — deploying <span style={{ color: LOBSTER_COLOR }}>{shareText}</span> of capital in a <span style={{ color: LOBSTER_COLOR }}>{poolRange.min}%</span> to <span style={{ color: LOBSTER_COLOR }}>+{poolRange.max}%</span> range from current price</>}{isLast && '"'}
                    </p>
                  );
                })}
              </>
            )}
          </div>
        {/* Buttons */}
        <div className="flex flex-row justify-center @7xl:flex-col gap-2 basis-full @7xl:basis-auto @7xl:shrink-0">
            <button
              type="button"
              onClick={handleSendToOpenClaw}
              disabled={isSendingCommand || selectedPools.length === 0}
              className="h-8 w-full px-3 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-50 border hover:brightness-110 flex items-center justify-center gap-1.5"
              style={{
                backgroundColor: `${LOBSTER_COLOR}15`,
                borderColor: `${LOBSTER_COLOR}30`,
                color: LOBSTER_COLOR,
              }}
            >
              {connectionStatus === 'unconfigured'
                ? 'Configuration Required'
                : isStrategyMode ? 'Send Strategy' : 'Send to OpenClaw'}
            </button>
            <button
              type="button"
              onClick={handleCopyMessage}
              disabled={selectedPools.length === 0}
              className="h-8 w-full px-3 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-50 border hover:brightness-110 flex items-center justify-center gap-1.5"
              style={{
                backgroundColor: `${LOBSTER_COLOR}15`,
                borderColor: `${LOBSTER_COLOR}30`,
                color: LOBSTER_COLOR,
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Copy" role="img">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {isStrategyMode ? 'Copy strategy' : 'Copy full message'}
            </button>
        </div>

      </div>


      {/* ═══════════════════════════════════════════════════════════════════════
          MANAGED POOLS LIST
          ═══════════════════════════════════════════════════════════════════════ */}
      {(selectedPools.length > 0 || unsupportedPools.length > 0) && (
        <div className="mt-4">
          {/* Liquidity Distribution + Range Mode + Position — always centered, single instance */}
          <div className="flex items-start justify-center gap-4 mb-3">
            <div className="flex flex-col items-center">
              <span className="text-xs text-white/50 mb-1">Liquidity Distribution</span>
              <div className="flex items-center p-0.5 glass rounded-lg">
                <button
                  type="button"
                  onClick={() => setDistributionMode('equal')}
                  className={cn(
                    'h-7 min-w-[55px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                    distributionMode === 'equal' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                  )}
                  style={distributionMode === 'equal' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                >
                  {`Equal ${balanceMode === 'all' ? '%' : '$'}`}
                </button>
                <button
                  type="button"
                  onClick={() => setDistributionMode('custom')}
                  className={cn(
                    'h-7 min-w-[55px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                    distributionMode === 'custom' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                  )}
                  style={distributionMode === 'custom' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                >
                  {`Individual ${balanceMode === 'all' ? '%' : '$'}`}
                </button>
              </div>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xs text-white/50 mb-1">Range Mode</span>
              <div className="flex items-center p-0.5 glass rounded-lg">
                <button
                  type="button"
                  onClick={() => setRangeMode('same')}
                  className={cn(
                    'h-7 min-w-[70px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                    rangeMode === 'same' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                  )}
                  style={rangeMode === 'same' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                >
                  Same for all
                </button>
                <button
                  type="button"
                  onClick={() => setRangeMode('custom')}
                  className={cn(
                    'h-7 min-w-[70px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                    rangeMode === 'custom' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                  )}
                  style={rangeMode === 'custom' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                >
                  Individual
                </button>
              </div>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xs text-white/50 mb-1">Position</span>
              <div className="flex items-center p-0.5 glass rounded-lg">
                <button
                  type="button"
                  onClick={() => setPositionMode('percent')}
                  className={cn(
                    'h-7 min-w-[55px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                    positionMode === 'percent' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                  )}
                  style={positionMode === 'percent' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                >
                  Range %
                </button>
                <button
                  type="button"
                  onClick={() => setPositionMode('fixed')}
                  className={cn(
                    'h-7 min-w-[55px] px-2 rounded-md text-xs font-medium transition-all duration-200 active:scale-[0.97]',
                    positionMode === 'fixed' ? '' : 'text-monad-purple-light/60 hover:bg-white/5'
                  )}
                  style={positionMode === 'fixed' ? { color: LOBSTER_COLOR, backgroundColor: `${LOBSTER_COLOR}15`, border: `1px solid ${LOBSTER_COLOR}40` } : undefined}
                >
                  Token Value
                </button>
              </div>
            </div>
          </div>

          {/* Central Range Header Row - only when Same for all mode */}
          {rangeMode === 'same' && (
            <div className="flex items-center gap-3 py-1.5 mb-1">
              {/* Empty columns to match pool row alignment — hidden when stacked */}
              <div className="hidden @7xl:block w-[150px] shrink-0" />
              <div className="hidden @7xl:block w-[100px] shrink-0" />
              <div className="hidden @7xl:block w-[50px] shrink-0" />
              <div className="hidden @7xl:flex w-[50px] shrink-0 items-end justify-center">
                <span className="text-[11px] text-white/40">Wallet %</span>
              </div>
              {/* Central Range Slider */}
              <div className="flex-1 min-w-0">
                {/* Slider row */}
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={`${centralMinPercent}%`}
                    onChange={(e) => {
                      const val = parseInt(e.target.value.replace(/[^0-9]/g, ''));
                      if (!isNaN(val) && val >= 0 && val <= 99) setCentralMinPercent(-val);
                    }}
                    className="w-14 h-7 px-1 rounded-md text-[11px] text-center font-medium shrink-0 focus-visible:ring-0 shadow-none transition-colors"
                    style={{
                      color: LOBSTER_COLOR,
                      textShadow: `0 0 8px ${LOBSTER_COLOR}60`,
                      backgroundColor: `${LOBSTER_COLOR}10`,
                      border: `1px solid ${LOBSTER_COLOR}30`,
                    }}
                  />
                  <div className="flex-1 min-w-[100px]">
                    <RangeSlider
                      minPercent={centralMinPercent}
                      maxPercent={centralMaxPercent}
                      onMinChange={setCentralMinPercent}
                      onMaxChange={setCentralMaxPercent}
                      accentColor={LOBSTER_COLOR}
                      neon
                    />
                  </div>
                  <Input
                    type="text"
                    value={`+${centralMaxPercent}%`}
                    onChange={(e) => {
                      const val = parseInt(e.target.value.replace(/[^0-9]/g, ''));
                      if (!isNaN(val) && val >= 0) setCentralMaxPercent(val);
                    }}
                    className="w-14 h-7 px-1 rounded-md text-[11px] text-center font-medium shrink-0 focus-visible:ring-0 shadow-none transition-colors"
                    style={{
                      color: LOBSTER_COLOR,
                      textShadow: `0 0 8px ${LOBSTER_COLOR}60`,
                      backgroundColor: `${LOBSTER_COLOR}10`,
                      border: `1px solid ${LOBSTER_COLOR}30`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}


          {/* Column header for "Deploy" — only needed in Individual mode (Same for all mode has it in the spacer row) */}
          {rangeMode === 'custom' && (
            <div className="hidden @7xl:flex items-center gap-3 mb-0.5">
              <div className="w-[150px] shrink-0" />
              <div className="w-[100px] shrink-0" />
              <div className="w-[50px] shrink-0" />
              <div className="w-[50px] shrink-0 flex justify-center">
                <span className="text-[11px] text-white/40">Wallet %</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            {selectedPools.map((pool) => {
              const dexConfig = DEX_CONFIG[pool.protocolName as DexType];
              const dexColor = dexConfig?.color || LOBSTER_COLOR;
              const poolRange = getPoolRange(pool.id);
              const isKuruVault = isVaultPool(pool);

              return (
                <div
                  key={pool.id}
                  className="flex flex-wrap @7xl:flex-nowrap items-center gap-3 py-1"
                >
                  {/* Pool Info - FIXED WIDTH (matches TanStack table styling) */}
                  <div className="flex items-center gap-2 w-[150px] shrink-0">
                    <TokenPairLogo
                      symbolX={pool.tokenXSymbol}
                      symbolY={pool.tokenYSymbol}
                      size="sm"
                    />
                    <div className="min-w-0 flex flex-col">
                      <span
                        className="text-sm font-semibold leading-tight truncate"
                        style={{ color: dexColor }}
                      >
                        {pool.tokenXSymbol}/{pool.tokenYSymbol}
                      </span>
                      <span className="text-xs text-monad-purple-light/40">
                        {pool.feePercent % 1 === 0 ? pool.feePercent.toFixed(1) : pool.feePercent.toFixed(2)}% fee
                      </span>
                    </div>
                  </div>

                  {/* DEX - FIXED WIDTH */}
                  <div className="flex items-center gap-1.5 w-[100px] shrink-0">
                    {dexConfig?.logo && (
                      <Image
                        src={dexConfig.logo}
                        alt={pool.protocolName}
                        width={14}
                        height={14}
                        className="rounded-full shrink-0"
                      />
                    )}
                    <span className="text-sm truncate" style={{ color: dexColor }}>{pool.protocolName}</span>
                  </div>

                  {/* Metric - FIXED WIDTH */}
                  <div className="w-[50px] shrink-0 text-right">
                    <span className="text-sm font-medium" style={{ color: LOBSTER_COLOR }}>
                      {metricDisplay === 'apr'
                        ? `${(pool.combinedAPR ?? 0).toFixed(0)}%`
                        : formatPercent(pool.normalizedBestlyReturn)
                      }
                    </span>
                  </div>

                  {/* Allocation - AUM % to deploy on this pool */}
                  <div className="w-[50px] shrink-0 flex justify-center">
                    <Input
                      type="text"
                      value={`${getPoolAllocation(pool.id)}%`}
                      disabled={distributionMode === 'equal'}
                      onFocus={(e) => {
                        // Select just the number part on focus for easy editing
                        const val = e.target.value.replace('%', '');
                        e.target.value = val;
                        e.target.select();
                      }}
                      onBlur={(e) => {
                        // Re-append % on blur
                        const val = parseInt(e.target.value.replace(/[^0-9]/g, ''));
                        if (!isNaN(val)) setPoolAllocation(pool.id, val);
                        e.target.value = `${getPoolAllocation(pool.id)}%`;
                      }}
                      onChange={(e) => {
                        const val = parseInt(e.target.value.replace(/[^0-9]/g, ''));
                        if (!isNaN(val)) setPoolAllocation(pool.id, val);
                      }}
                      className={cn(
                        'w-[44px] h-7 px-1 rounded-md text-xs md:text-sm text-center font-medium shrink-0 focus-visible:ring-0 shadow-none transition-colors',
                        distributionMode === 'equal' ? 'text-white/30' : 'text-white/70'
                      )}
                      style={{
                        backgroundColor: distributionMode === 'equal' ? 'transparent' : `${LOBSTER_COLOR}10`,
                        border: distributionMode === 'equal' ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${LOBSTER_COLOR}30`,
                      }}
                    />
                  </div>

                  {/* Range Selector — wraps to full-width new line when narrow */}
                  {isKuruVault ? (
                    <div className="flex items-center gap-2 min-w-0 basis-full @7xl:basis-0 @7xl:flex-1">
                      <span
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider"
                        style={{
                          backgroundColor: `${dexColor}15`,
                          border: `1px solid ${dexColor}30`,
                          color: dexColor,
                        }}
                      >
                        Vault
                      </span>
                      <span className="text-[11px] text-white/35">Auto-managed spread — no range needed</span>
                    </div>
                  ) : rangeMode === 'custom' ? (
                    (() => {
                      const basePrice = pool.priceX ?? 0;
                      const lowerPrice = basePrice * (1 + poolRange.min / 100);
                      const upperPrice = basePrice * (1 + poolRange.max / 100);
                      const leftLabel = positionMode === 'percent' ? `${poolRange.min}%` : formatPrice(lowerPrice);
                      const rightLabel = positionMode === 'percent' ? `+${poolRange.max}%` : formatPrice(upperPrice);

                      return (
                        <div className="flex items-center gap-2 min-w-0 basis-full @7xl:basis-0 @7xl:flex-1">
                          <Input
                            type="text"
                            value={leftLabel}
                            onChange={(e) => {
                              const val = parseInt(e.target.value.replace(/[^0-9]/g, ''));
                              if (!isNaN(val) && val >= 0 && val <= 99) setPoolRange(pool.id, -val, poolRange.max);
                            }}
                            className="w-14 h-7 px-1 rounded-md text-[11px] text-center font-medium shrink-0 focus-visible:ring-0 shadow-none transition-colors"
                            style={{
                              backgroundColor: `${LOBSTER_COLOR}10`,
                              border: `1px solid ${LOBSTER_COLOR}30`,
                              color: LOBSTER_COLOR,
                            }}
                            readOnly={positionMode === 'fixed'}
                          />
                          <div className="flex-1 min-w-[100px]">
                            <RangeSlider
                              minPercent={poolRange.min}
                              maxPercent={poolRange.max}
                              onMinChange={(val) => setPoolRange(pool.id, val, poolRange.max)}
                              onMaxChange={(val) => setPoolRange(pool.id, poolRange.min, val)}
                              accentColor={LOBSTER_COLOR}
                            />
                          </div>
                          <Input
                            type="text"
                            value={rightLabel}
                            onChange={(e) => {
                              const val = parseInt(e.target.value.replace(/[^0-9]/g, ''));
                              if (!isNaN(val) && val >= 0) setPoolRange(pool.id, poolRange.min, val);
                            }}
                            className="w-14 h-7 px-1 rounded-md text-[11px] text-center font-medium shrink-0 focus-visible:ring-0 shadow-none transition-colors"
                            style={{
                              backgroundColor: `${LOBSTER_COLOR}10`,
                              border: `1px solid ${LOBSTER_COLOR}30`,
                              color: LOBSTER_COLOR,
                            }}
                            readOnly={positionMode === 'fixed'}
                          />
                        </div>
                      );
                    })()
                  ) : (
                    // Show greyed-out range display when Same for all mode
                    (() => {
                      const basePrice = pool.priceX ?? 0;
                      const lowerPrice = basePrice * (1 + centralMinPercent / 100);
                      const upperPrice = basePrice * (1 + centralMaxPercent / 100);

                      const leftLabel = positionMode === 'percent' ? `${centralMinPercent}%` : formatPrice(lowerPrice);
                      const rightLabel = positionMode === 'percent' ? `+${centralMaxPercent}%` : formatPrice(upperPrice);

                      return (
                        <div className="flex items-center gap-2 min-w-0 basis-full @7xl:basis-0 @7xl:flex-1 opacity-40">
                          <span
                            className="w-14 h-7 px-1 rounded-md text-[11px] text-center font-medium shrink-0 flex items-center justify-center"
                            style={{
                              backgroundColor: `${LOBSTER_COLOR}10`,
                              border: `1px solid ${LOBSTER_COLOR}30`,
                              color: LOBSTER_COLOR,
                            }}
                          >{leftLabel}</span>
                          <div className="flex-1 min-w-[100px]">
                            <RangeSlider
                              minPercent={centralMinPercent}
                              maxPercent={centralMaxPercent}
                              onMinChange={() => {}}
                              onMaxChange={() => {}}
                              accentColor={LOBSTER_COLOR}
                              disabled
                            />
                          </div>
                          <span
                            className="w-14 h-7 px-1 rounded-md text-[11px] text-center font-medium shrink-0 flex items-center justify-center"
                            style={{
                              backgroundColor: `${LOBSTER_COLOR}10`,
                              border: `1px solid ${LOBSTER_COLOR}30`,
                              color: LOBSTER_COLOR,
                            }}
                          >{rightLabel}</span>
                        </div>
                      );
                    })()
                  )}

                </div>
              );
            })}

            {/* Unsupported pools — shown with badge, no controls */}
            {unsupportedPools.map((pool) => {
              const dexConfig = DEX_CONFIG[pool.protocolName as DexType];
              const dexColor = dexConfig?.color || '#666';
              return (
                <div key={pool.id} className="flex items-center gap-3 py-1 opacity-40">
                  <div className="flex items-center gap-2 w-[150px] shrink-0">
                    <TokenPairLogo symbolX={pool.tokenXSymbol} symbolY={pool.tokenYSymbol} size="sm" />
                    <div className="min-w-0 flex flex-col">
                      <span className="text-sm font-semibold leading-tight truncate" style={{ color: dexColor }}>
                        {pool.poolPair}
                      </span>
                      <span className="text-xs text-white/30">{pool.protocolName}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/10 text-red-400/70 border border-red-500/20 uppercase tracking-wider">
                    Unsupported DEX
                  </span>
                  <span className="text-[11px] text-white/25 ml-auto">No liquidity skill available — excluded from deployment</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Connection Status (Sonner-style toast at bottom) ────────────── */}
      {/* Hidden when unconfigured — the Send button handles that case with a redirect to settings */}
      {!statusDismissed && connectionStatus !== 'unconfigured' && (
        <div
          className="mt-3 flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 backdrop-blur-xl text-xs shadow-lg"
          style={{
            borderColor: connectionStatus === 'connected' ? 'rgba(52, 211, 153, 0.25)'
              : connectionStatus === 'checking' ? 'rgba(250, 204, 21, 0.25)'
              : 'rgba(248, 113, 113, 0.25)',
            background: connectionStatus === 'connected'
              ? 'linear-gradient(135deg, rgba(52, 211, 153, 0.12) 0%, rgba(52, 211, 153, 0.04) 100%)'
              : connectionStatus === 'checking'
                ? 'linear-gradient(135deg, rgba(250, 204, 21, 0.12) 0%, rgba(250, 204, 21, 0.04) 100%)'
                : 'linear-gradient(135deg, rgba(248, 113, 113, 0.12) 0%, rgba(248, 113, 113, 0.04) 100%)',
          }}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0 animate-pulse"
            style={{
              backgroundColor: connectionStatus === 'connected' ? '#34d399'
                : connectionStatus === 'checking' ? '#facc15'
                : '#f87171',
              boxShadow: connectionStatus === 'connected' ? '0 0 6px rgba(52, 211, 153, 0.5)'
                : connectionStatus === 'checking' ? '0 0 6px rgba(250, 204, 21, 0.5)'
                : '0 0 6px rgba(248, 113, 113, 0.5)',
            }}
          />
          <span className="flex-1 min-w-0">
            {connectionStatus === 'connected' && (
              <span className="text-emerald-400 font-medium">{statusDetail}</span>
            )}
            {connectionStatus === 'checking' && (
              <span className="text-yellow-300 font-medium">{statusDetail}</span>
            )}
            {connectionStatus === 'error' && (
              <span className="text-yellow-400 font-medium">
                {statusDetail} —{' '}
                <Link href="/openclaw/settings" className="underline decoration-yellow-400/40 hover:text-yellow-300 transition-colors">
                  go to settings
                </Link>
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => { setStatusDismissed(true); sessionStorage.setItem('lobster-status-dismissed', '1'); }}
            className="shrink-0 p-0.5 rounded-md transition-colors hover:bg-white/10"
            style={{
              color: connectionStatus === 'connected' ? '#34d399'
                : connectionStatus === 'checking' ? '#facc15'
                : '#f87171',
            }}
            aria-label="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </GlassBanner>
  );
});
