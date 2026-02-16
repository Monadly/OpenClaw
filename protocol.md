# Monadly → OpenClaw Communication Protocol

This document specifies **exactly** what Monadly sends when you click "Send to OpenClaw".
No hidden payloads, no telemetry, no data collection. Fully auditable.

**Source code references:**
- Transport logic: [`OpenClaw/src/useBotCommand.ts`](src/useBotCommand.ts)
- Telegram proxy: [`OpenClaw/src/telegram-proxy.ts`](src/telegram-proxy.ts)
- Config management: [`OpenClaw/src/useOpenClawConfig.ts`](src/useOpenClawConfig.ts)
- Settings page: [`OpenClaw/src/settings-page.tsx`](src/settings-page.tsx)

---

## Transport Methods

Users choose one of two transports. Both send the **same message format** — only the delivery path differs.

### 1. Tailscale Direct (Recommended)

```
Browser → Tailscale private network → OpenClaw /hooks/agent
```

**What leaves your browser:**

```http
POST {your-tailscale-url}/hooks/agent
Content-Type: application/json
x-openclaw-token: {your-token}

{
  "message": "<natural language command — see Message Formats below>",
  "name": "Monadly",
  "deliver": true,
  "channel": "telegram",
  "timeoutSeconds": 120
}
```

| Field | Purpose | Sensitive? |
|-------|---------|-----------|
| `message` | The command text (see below) | No — it's a natural language instruction |
| `name` | Identifies the sender | No |
| `deliver` | Tells OpenClaw to send the response to user | No |
| `channel` | Where to deliver the response | No |
| `timeoutSeconds` | How long OpenClaw should spend on the task | No |

**Nothing else is sent.** No wallet addresses, no private keys, no browser fingerprints, no analytics.

The `x-openclaw-token` header authenticates the request. The token is a shared secret stored in your browser's localStorage — it never reaches Monadly's servers.

### 2. Telegram

```
Browser → Monadly API proxy → Telegram Bot API → OpenClaw bot
```

**What leaves your browser (to Monadly's server):**

```http
POST /api/openclaw/send
Content-Type: application/json

{
  "botToken": "{your-bot-token}",
  "chatId": "{your-chat-id}",
  "message": "<natural language command>"
}
```

**What Monadly's server forwards to Telegram:**

```http
POST https://api.telegram.org/bot{token}/sendMessage
Content-Type: application/json

{
  "chat_id": "{chatId}",
  "text": "{message}",
  "parse_mode": "Markdown"
}
```

The proxy exists because browsers block direct requests to `api.telegram.org` (CORS).
The bot token passes through the server but is **never stored, logged, or cached**.

---

## Message Formats

Every button click generates a natural language message. These are the **exact templates** used:

### Single-Pool Commands (Inline Buttons)

**Analyze Position** (`pool:analyze`):
```
Analyze the {DEX} {PAIR} pool.
Pool: {address} | Chain: Monad (143)
Report: current APR, TVL, active bin, position status
```

**Check Position** (`pool:position`):
```
Check my position in the {DEX} {PAIR} pool.
Pool: {address} | Chain: Monad (143)
```

**Rebalance Range** (`pool:rebalance`):
```
Rebalance my position in the {DEX} {PAIR} pool.
Pool: {address} | Chain: Monad (143)
```

**Send to OpenClaw / Deploy** (`pool:set-range`):
```
Deploy my liquidity on {DEX} {PAIR} pool.
Pool: {address} | Chain: Monad (143)
Range: {min}% to +{max}% | Mode: {fixed/follow} | Bins: {N}
Rebalance: {frequency}
```

**Customize Alerts** (`pool:alert`):
```
Set alerts for the {DEX} {PAIR} pool.
Pool: {address} | Chain: Monad (143)
Current APR: {apr}% | TVL: ${tvl}
```

**Bot Status** (`bot:status`):
```
Report status of all my positions.
Include: position value, P&L, range status, last rebalance time
```

### Multi-Pool Commands (Lobster Command Center)

The Lobster Dashboard builds a multi-pool deployment message:

```
OpenClaw, deploy {amount} across {N} {manual/dynamic} pools, {distribution}, {range}. At epoch end, {behavior}.

Chain: Monad (chainId: 143)

Position Settings:
- Mode: {Range % / Fixed $ Value}
- Range Type: {Fixed / Follow Price (Dynamic)}
- Rebalance: {frequency}

Pool Deployment Details:

1. {PAIR} on {DEX}
   Deploy: 1/{N} of {amount}
   Range: {min}% to +{max}%
   Price Range: ${lower} - ${upper}
   Pool Address: {address}
   Fee Tier: {fee}%
   Current TVL: ${tvl}
   APR: {apr}%

2. ...

Skills: Use /monadly-core for safety checks, then the appropriate DEX skill for execution.
Verify all addresses against each skill's SKILL.md (Contract Addresses section) before transacting.
```

### Strategy Activation Message (Lobster Command Center — Dynamic Mode)

When users select **Dynamic** mode in the Lobster Dashboard, the "Copy Strategy" / "Send Strategy" button generates an autonomous management instruction instead of a one-shot deploy. This message tells OpenClaw to enter its monitoring loop and manage positions continuously.

```text
OpenClaw, start auto-managing my liquidity.

Strategy: Top {N} pools by {APR|Real Return} (Bestly Score)
Capital: {$amount|my entire wallet balance}, {equally distributed|with custom allocation weights}
Position mode: {Range %|Fixed $ Value}
Range: {min}% to +{max}% from active bin (unified for all) | individual custom ranges per pool
Range type: {Follow Price (Dynamic)|Fixed}
Check interval: Every {5|10|30} minutes | 1 hour
Rebalance trigger: {Every check|When out of range|None (fixed ranges)}
Pool rotation: Yes, when pool drops out of Top {N}
Epoch behavior: {Withdraw and keep aside|Use liquidity on other pools|Remain in the pool}
Status reports: {Every cycle|On actions only} via Telegram

Chain: Monad (chainId: 143)
Data source: https://monadly.xyz/openclaw.txt

Currently the top pools are:
1. {PAIR} on {DEX} — {metric}
   Pool Address: {address}
   Range: {min}% to +{max}%
   Fee Tier: {fee}% | TVL: ${tvl} | APR: {apr}%

2. ...

Skills: Use /monadly-core for safety checks, then the appropriate DEX skill for execution.
Verify all addresses against each skill's SKILL.md (Contract Addresses section) before transacting.
```

| Field | Source | Purpose |
|-------|--------|---------|
| `Strategy` | Pool count + sort metric | Defines which pools to target |
| `Capital` | User input (fixed amount or "entire wallet") | How much to deploy |
| `Position mode` | UI toggle | % range vs fixed $ value |
| `Range` | Central or per-pool sliders | Price range around active bin |
| `Range type` | UI toggle | Static or follow price |
| `Check interval` | UI selector (5m/10m/30m/1h) | How often OpenClaw checks positions |
| `Rebalance trigger` | Derived from range type | When to rebalance |
| `Pool rotation` | Always "Yes" in dynamic mode | Rotate underperforming pools |
| `Epoch behavior` | UI radio buttons | What to do when rewards epoch ends |
| `Status reports` | UI toggle | How often to send Telegram updates |
| `Data source` | Fixed URL | Where OpenClaw fetches live rankings |
| Pool listings | Current top N from Monadly data | Starting pool set for initial deployment |

**Difference from one-shot deploy:** The strategy message begins with "start auto-managing" (not "deploy"), includes `Check interval`, `Rebalance trigger`, `Pool rotation`, `Status reports`, and references `openclaw.txt` as the live data source. OpenClaw enters its monitoring loop upon receiving this message.

### Telegram Echo (Tailscale only)

When using Tailscale transport, the command is also echoed to your Telegram (so you see what was sent):

```
🦞 *Monadly Command:*
{the same message sent to OpenClaw}
```

This echo is fire-and-forget — if it fails, the actual command still goes through.

---

## What Monadly Does NOT Send

- Private keys or seed phrases
- Wallet addresses (only pool contract addresses from public data)
- Browser fingerprints or device IDs
- Analytics or tracking data
- IP addresses (Tailscale handles routing; Telegram proxy doesn't log)
- Any data beyond the message formats documented above

---

## Credential Storage

All credentials are stored **exclusively** in your browser's `localStorage`:

| Key | Contains | Leaves browser? |
|-----|----------|----------------|
| `openclawTransport` | `"tailscale"` or `"telegram"` | No |
| `openclawUrl` | Your Tailscale URL | Sent to your own machine only |
| `openclawToken` | Shared secret for auth | Sent in `x-openclaw-token` header to your machine |
| `openclawBotToken` | Telegram bot token | Sent through Monadly proxy to Telegram API |
| `openclawChatId` | Telegram chat ID | Sent through Monadly proxy to Telegram API |

No credentials are stored on Monadly's servers. Clearing browser data removes them.

---

## Security Model

```
Layer 1: Tailscale (network) — Only your devices can reach the endpoint
Layer 2: Token (authentication) — Only authorized apps can send commands
Layer 3: Agent (authorization) — OpenClaw asks for confirmation before transactions
```

See [`skills/monadly-core/SKILL.md`](skills/monadly-core/SKILL.md) → "Webhook Security & Confirmation Flow" for the full agent-side security spec.

---

## Verifying Yourself

Open browser DevTools (Network tab) and click any "Send to OpenClaw" button.
You will see exactly one request matching what's documented above. Nothing more.
