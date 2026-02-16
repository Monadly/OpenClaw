# 🦞 OpenClaw Integration Manager

> **Status**: Phase 4 Complete — All features implemented
> **Last Updated**: 2026-02-15

---

## Overview

Dual transport system for sending DeFi commands from Monadly UI to user's OpenClaw instance. Users choose their preferred transport method in `/openclaw/settings`:

1. **Tailscale Direct** — Browser → OpenClaw via private Tailscale network (zero trust, most secure)
2. **Telegram** — Browser → Monadly API → Telegram Bot API → OpenClaw (easiest setup)

**Key decisions:**
- ✅ Local storage (no database for MVP)
- ✅ Dual transport: Tailscale Direct + Telegram (user-selectable)
- ✅ `x-openclaw-token` header auth (matches OpenClaw's native auth)
- ✅ Natural language messages (OpenClaw's skills parse them)
- ✅ Short tokens (`mndly_` + 16 chars) for Tailscale auth
- ✅ Telegram proxy via Vercel serverless (CORS workaround)
- ✅ Credentials stay in browser localStorage (server stores nothing)

---

## Architecture

```
                        ┌─ Tailscale Direct ──────────────┐
                        │  (Zero trust — most secure)      │
Browser (monadly.xyz)   │                                  │
  │                     │  fetch(tailscaleUrl/hooks/agent)  │──► OpenClaw
  │  useBotCommand()    │  x-openclaw-token: <token>       │
  │                     └──────────────────────────────────┘
  │
  │                     ┌─ Telegram ──────────────────────┐
  │                     │  (Easiest setup)                 │
  │  /api/openclaw/send │                                  │
  │  ──────────────────►│  Telegram Bot API sendMessage    │──► OpenClaw
  │                     │  (bot token passes through,      │    (Telegram bot)
  │                     │   never stored on server)        │
  │                     └──────────────────────────────────┘
  │
  └── User chooses transport in /openclaw/settings
```

### Storage Model
```
┌─────────────────────────────────────────────────────────────────┐
│  Browser localStorage                                           │
│  ├── openclawTransport: "tailscale" | "telegram"                │
│  ├── openclawUrl: "https://machine.tail1234.ts.net"  (Tailscale)│
│  ├── openclawToken: "mndly_Kj9xP2mQ4nR7vT5w"       (Tailscale)│
│  ├── openclawBotToken: "123456789:ABCdefGHI..."      (Telegram) │
│  ├── openclawChatId: "389908939"                     (Telegram) │
│  └── openclawShowCommands: "true"                               │
│                                                                  │
│  Server: stores NOTHING (zero-knowledge)                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: Dual Transport (Complete)

#### 1.1 Telegram Proxy API Route
- [x] Create `OpenClaw/src/telegram-proxy.ts`
  - [x] Accept `{ botToken, chatId, message }` POST body
  - [x] Validate inputs (token format, numeric chatId, message length)
  - [x] Proxy to `api.telegram.org/bot<token>/sendMessage`
  - [x] Map Telegram error codes to user-friendly messages

#### 1.2 useBotCommand Hook (Rewrite)
- [x] Rewrite `OpenClaw/src/useBotCommand.ts`
  - [x] Remove HMAC-SHA256 signing (replaced by `x-openclaw-token` header)
  - [x] Add `buildCommandMessage()` — natural language templates
  - [x] Add `sendViaTailscale()` — direct fetch to `/hooks/agent`
  - [x] Add `sendViaTelegram()` — via API proxy route
  - [x] Transport-switching `sendCommand()` reads from localStorage

#### 1.3 useOpenClawConfig Hook (Rewrite)
- [x] Rewrite `OpenClaw/src/useOpenClawConfig.ts`
  - [x] `Transport` type: `'tailscale' | 'telegram'`
  - [x] Dual credential storage (Tailscale URL+token, Telegram botToken+chatId)
  - [x] Transport-aware `configured` logic
  - [x] `generateToken()` — same `mndly_` format
  - [x] Cross-tab sync via CustomEvent + StorageEvent

#### 1.4 Settings Page (Rewrite)
- [x] Rewrite `OpenClaw/src/settings-page.tsx`
  - [x] Transport selector cards (Tailscale vs Telegram)
  - [x] Tailscale config section (token + URL)
  - [x] Telegram config section (bot token + chat ID)
  - [x] Test Connection button
  - [x] Updated setup guide (3 steps)
  - [x] CLI command section updated to `hooks.token`

#### 1.5 OpenClawRowContent (Minor)
- [x] Update header comment in `OpenClawRowContent.tsx`
- [x] Keep all command handlers unchanged (hook handles conversion)
- [x] Keep clipboard message separate (includes skill references)

---

### Phase 2: Pool Table Integration (Previously Complete)

- [x] 🦞 button in pool table rows
- [x] Expandable OpenClawRowContent with range selector
- [x] Command handlers: analyze, rebalance, set-range, alert
- [x] Copy full message to clipboard
- [x] Persisted range settings per pool

---

### Phase 3: Skills (Previously Complete)

- [x] `monadly-core/` — Safety, orchestration, state management
- [x] `lfj-liquidity/` — LFJ Liquidity Book interactions
- [x] `wallet-manager/` — Wallet creation, key storage

---

### Gateway Service (Superseded)

> The standalone Express gateway at `OpenClaw/Gateway/` is **superseded** by the
> dual transport approach. It was designed for HMAC-signed proxy forwarding, but:
> - Tailscale Direct: browser sends directly (no proxy needed)
> - Telegram: Vercel serverless function handles the proxy
>
> The Gateway code remains for reference but is not actively used.

---

#### 1.6 Lombester Dashboard Integration
- [x] Import `useBotCommand` in `LombesterDashboard.tsx`
- [x] Add `sendRawMessage()` to hook for pre-built messages
- [x] Extract `buildDeployMessage()` shared by Send and Copy buttons
- [x] Replace stub `handleSendToOpenClaw` with real transport call

#### 1.7 Connection Status Indicators
- [x] Add `connectionStatus` state to `useBotCommand` hook (`idle` | `connected` | `error`)
- [x] Health check on mount via OPTIONS preflight to Tailscale endpoint (5s timeout)
- [x] Green dot (connected) / yellow triangle (error) inside "Send to OpenClaw" button
- [x] Indicator shown in both `OpenClawRowContent.tsx` and `LombesterDashboard.tsx`
- [x] Re-checks on config change via StorageEvent + CustomEvent listeners

#### 1.8 Public Auditability Restructure
- [x] Move all OpenClaw source files to `OpenClaw/src/`
- [x] Add `@openclaw/*` path alias in `tsconfig.json`
- [x] Leave 1-line re-exports in Next.js locations
- [x] Create `protocol.md` — full wire format transparency spec

---

### Uninstalling

The uninstall guide lives inside `skills/monadly-core/SKILL.md` (final section) so the agent can walk users through it interactively. Key: always withdraw all positions before removing anything.

---

### Phase 4: Autonomous Strategy Mode


#### 4.1 monadly-core SKILL.md
- [x] Fix all data source URLs (`openclaw.md` → `openclaw.txt`) — 9 references
- [x] Add ~250-line "Autonomous Strategy Mode" section after Portfolio Management
  - [x] Strategy Activation Flow (6-step: parse → confirm → check positions → save → deploy → loop)
  - [x] Strategy Config Schema (positions.json extension with `strategy` block)
  - [x] Strategy vs Auto-Manage Override rules
  - [x] Enhanced Monitoring Loop decision tree (fetch → parse → check → rotate → execute → report)
  - [x] Status Report Templates (routine check, rebalance event, pool rotation event)
  - [x] Strategy Control Commands (pause, resume, stop, status, dry-run)


#### 4.2 Lobster Dashboard Strategy Controls
- [x] Add `checkInterval` state (5m/10m/30m/1h) with persisted localStorage
- [x] Add `statusReports` toggle (every-cycle / actions-only) with persisted localStorage
- [x] Rewrite `buildDeployMessage()` to branch on `isStrategyMode` (dynamic = strategy)
- [x] Strategy message includes all fields: check interval, rebalance trigger, pool rotation, epoch behavior, status reports, data source
- [x] Updated command preview to multi-line layout for strategy mode
- [x] Updated button labels: "Send Strategy" / "Copy Strategy" in dynamic mode


#### 4.3 Documentation
- [x] Add Strategy Activation Message format to `protocol.md`
- [x] Update `openclaw-manager.md` with Phase 4 checklist and changelog

---

### Future Enhancements (Backlog)

- [ ] **Receive responses**: OpenClaw → Monadly (reverse direction)
- [ ] **Cloud Sync**: Supabase accounts with encrypted credential storage
- [ ] **Multiple Bots**: Support connecting to multiple OpenClaw instances
- [ ] **Command History**: Show recent commands sent
- [ ] **Wallet Integration**: Connect wallet for on-chain actions
- [ ] **Credential Masking**: `type="password"` for Telegram bot token input
- [ ] **Autocomplete Off**: `autocomplete="off"` on credential inputs

---

## File Summary

### Source Code (`OpenClaw/src/` — publicly auditable)

| File | Status | Purpose |
|------|--------|---------|
| `OpenClaw/src/useBotCommand.ts` | ✅ Complete | Dual transport command sender, connection health check |
| `OpenClaw/src/useOpenClawConfig.ts` | ✅ Complete | Transport + credential management, cross-tab sync |
| `OpenClaw/src/settings-page.tsx` | ✅ Complete | Settings page with transport selector |
| `OpenClaw/src/telegram-proxy.ts` | ✅ Complete | Telegram proxy (Vercel serverless, CORS workaround) |
| `OpenClaw/protocol.md` | ✅ Complete | Wire format spec (public transparency document) |
| `OpenClaw/skills/` | ✅ Complete | 3 skills, 5,195 lines |

### Next.js Re-exports (thin wrappers in `src/`)

| File | Re-exports From |
|------|----------------|
| `src/hooks/useBotCommand.ts` | `@openclaw/useBotCommand` |
| `src/hooks/useOpenClawConfig.ts` | `@openclaw/useOpenClawConfig` |
| `src/app/openclaw/page.tsx` | `@openclaw/settings-page` |
| `src/app/api/openclaw/send/route.ts` | `@openclaw/telegram-proxy` |

### UI Components (private Monadly code)

| File | Status | Purpose |
|------|--------|---------|
| `src/components/pool-table/OpenClawRowContent.tsx` | ✅ Complete | Inline pool controls + connection indicator |
| `src/components/pool-table/LombesterDashboard.tsx` | ✅ Complete | Multi-pool command center + connection indicator |

### Superseded

| File | Status | Purpose |
|------|--------|---------|
| `OpenClaw/Gateway/` | ⏸ Superseded | Express proxy (kept for reference only) |

---

## OpenClaw API Reference

**HTTP Webhook (Tailscale transport):**
```
POST /hooks/agent
Port: 18789 (loopback — needs Caddy reverse proxy for CORS)
Auth: x-openclaw-token: <token>
Config: hooks.token in OpenClaw settings

Body:
{
  "message": "string — natural language instruction",
  "name": "Monadly",
  "deliver": true,
  "channel": "telegram",
  "timeoutSeconds": 120
}

Note: Monadly does NOT send sessionKey. OpenClaw manages session
routing via hooks.defaultSessionKey (recommended: "hook:ingress").
This follows the v2026.2.12+ security default (allowRequestSessionKey=false).

Response: 202 Accepted (async) or 200 OK
```

**Telegram Bot API (Telegram transport):**
```
POST https://api.telegram.org/bot<token>/sendMessage
Body: { "chat_id": "string", "text": "string", "parse_mode": "Markdown" }
```

**Telegram Echo (Tailscale only):**
When using Tailscale transport, commands are also echoed to Telegram (fire-and-forget) so the user can see what was sent:
```
🦞 *Monadly Command:*
{the same message sent to OpenClaw}
```

---

## Changelog

| Date | Change | By |
|------|--------|-----|
| 2026-02-15 | Phase 4: Autonomous Strategy Mode — SKILL.md (~250 lines), Dashboard controls, protocol docs | Claude |
| 2026-02-15 | Fixed 9 data source URL references (`openclaw.md` → `openclaw.txt`) | Claude |
| 2026-02-15 | Lobster Dashboard: check interval selector, status report toggle, strategy message format | Claude |
| 2026-02-15 | Removed sessionKey from hook payload (v2026.2.12 compat + security) | Claude |
| 2026-02-08 | Moved source to `OpenClaw/src/`, path aliases, public auditability | Claude |
| 2026-02-08 | Added `protocol.md` — full wire format transparency spec | Claude |
| 2026-02-08 | Lombester Dashboard: real transport integration, `sendRawMessage()` | Claude |
| 2026-02-08 | Connection status indicators (green dot/yellow triangle) in buttons | Claude |
| 2026-02-08 | Reverted HMAC-SHA256 → `x-openclaw-token` header (matches OpenClaw native auth) | Claude |
| 2026-02-08 | Skills: V2.2 `removeLiquidityNATIVE` signature fix, Webhook Security section | Claude |
| 2026-02-08 | Phase 1 complete: dual transport (Tailscale + Telegram) | Claude |
| 2026-02-05 | Skills complete: monadly-core, lfj-liquidity, wallet-manager (5,195 lines) | Claude |
| 2026-02-05 | Created implementation plan (gateway approach — later superseded) | Claude |
