# Monadly's OpenClaw Yield Farming DeFi Manager

[Monadly](https://monadly.xyz) is the DeFi aggregator hub for the Monad ecosystem. OpenClaw is Monadly's AI-powered yield farming layer that turns the dashboard's pool rankings and analytics into actionable liquidity management — deploying positions, executing swaps, and running autonomous portfolio strategies through natural language commands.

---

> **BETA SOFTWARE — USE AT YOUR OWN RISK**
>
> OpenClaw is in active development. While every skill includes simulation, safety checks, and confirmation prompts, **this is beta software interacting with real funds on-chain.** Exercise maximum caution:
>
> - **Wallet security is your responsibility.** Use a dedicated wallet for OpenClaw — never your main holdings. Follow the practices in `security-hardening_SKILL.md`.
> - **Keep OpenClaw up to date.** We continuously improve safety standards, fix edge cases, and harden the skills. Running outdated versions means missing critical security updates.
> - **Start small.** Test with amounts you can afford to lose. Increase capital only after you're confident in your setup.
> - **Follow [@DavideFi](https://x.com/DavideFi) on X** for release announcements, security advisories, and product updates.
>
> DeFi carries inherent risks — smart contract bugs, impermanent loss, oracle failures, and market volatility can all cause loss of funds. OpenClaw reduces operational risk but cannot eliminate protocol-level risk.

---

## How It Works

OpenClaw is a set of **skill files** that teach an AI agent (Claude Code, or any compatible LLM) how to interact with DeFi protocols on Monad. No SDK, no TypeScript library — just structured markdown instructions that the agent reads and executes using `cast` (Foundry CLI) and `curl`.

```text
You (natural language) ──> AI Agent ──> Reads SKILL.md ──> Executes on-chain via cast/curl
```

**The agent doesn't guess.** Every contract address, function signature, and safety check is documented in the skill files. The agent follows the instructions exactly.

### Two Ways to Use OpenClaw

**1. Direct Skills** — Load any skill file into your AI coding agent (Claude Code, Cursor, etc.) and give it commands. The agent reads the SKILL.md and knows exactly what to do.

```text
"Swap 10 MON for USDC on Kuru"
→ Agent reads kuru-swap_SKILL.md → Gets quote → Simulates → Executes
```

**2. Lobster Command Center** — The [Monadly dashboard](https://monadly.xyz) has a built-in command center that lets you configure multi-pool strategies visually. It generates the exact message format the agent expects, then sends it via Tailscale or Telegram.

```text
Dashboard UI ──> Builds strategy message ──> Sends to bot ──> Bot parses & executes autonomously
```

---

## Skills

Each skill is a self-contained instruction set for a specific DeFi domain. The agent loads only the skills it needs for a given task.

| Skill | Lines | Focus |
|-------|-------|-------|
| [`monadly-core`](skills/monadly-core_SKILL.md) | 2,987 | **Safety & orchestration.** Pre-flight checks, wallet verification, gas management, strategy mode, autonomous monitoring loop, pool rotation, and the full deployment pipeline. This is the brain — it decides WHAT to do and delegates HOW to the DEX-specific skills. |
| [`lfj-liquidity`](skills/lfj-liquidity_SKILL.md) | 2,354 | **LFJ (Liquidity Book) positions.** Bin-based concentrated liquidity — calculating active bins, selecting distribution shapes (Spot, Curve, Bid-Ask), deploying across bin ranges, claiming fees, and rebalancing. |
| [`clmm-liquidity`](skills/clmm-liquidity_SKILL.md) | 785 | **Uniswap V4 & PancakeSwap V3 positions.** Tick-based concentrated liquidity — computing tick ranges from price percentages, minting/burning NFT positions, collecting fees, and managing across both protocols. |
| [`security-hardening`](skills/security-hardening_SKILL.md) | 797 | **Defense-in-depth.** Wallet isolation, key management, transaction simulation, approval hygiene, incident response playbook, and post-incident forensics. Loaded before any high-value operation. |
| [`kuru-swap`](skills/kuru-swap_SKILL.md) | 251 | **Token swaps via Kuru Flow.** Aggregated routing through Kuru's CLOB markets — JWT auth, quote fetching, slippage protection, and transaction execution for any token pair on Monad. |
| [`kuru-liquidity`](skills/kuru-liquidity_SKILL.md) | 291 | **Kuru AMM Vault deposits.** ERC20-based vault positions with automatic spread management — no range configuration needed. Deposit, withdraw, and preview operations. |

**Total: 7,465 lines of DeFi expertise across 6 skills.**

---

## Getting Started

### Preview the Strategy Manager

Open the Lobster Command Center directly:

**[monadly.xyz/?lobster=3](https://monadly.xyz/?lobster=3)**

This opens the Monadly dashboard with the top 3 pools pre-selected and the strategy manager expanded. From there you can:
- Adjust pool count, capital allocation, ranges, and rebalancing settings
- Preview the exact strategy message the bot will receive
- Copy the message to paste into your own OpenClaw bot instance
- Or send it directly via Tailscale/Telegram if you have a bot configured

### Using Skills Directly

You don't need the dashboard. Load any skill file into your AI coding agent (Claude Code, Cursor, etc.) and start giving commands:

1. Clone this repo or download the skill you need
2. Tell your agent to read it:
   ```
   "Read skills/kuru-swap_SKILL.md and swap 10 MON for USDC"
   ```
3. The agent follows the instructions: checks balances, gets a quote, simulates, and asks for your confirmation before executing

**Prerequisites:**
- [Foundry](https://book.getfoundry.sh/) installed (`cast` CLI)
- `MONAD_RPC_URL` environment variable set
- `PRIVATE_KEY` environment variable set (for write operations)
- `curl` and `jq` available in your shell

### Using the Lobster Command Center

The [Monadly dashboard](https://monadly.xyz) has a built-in strategy manager called the Lobster Command Center:

1. Visit [monadly.xyz](https://monadly.xyz) (or use the [direct link](https://monadly.xyz/?lobster=3))
2. Select pools from the table using the checkboxes
3. The Command Center appears — configure your strategy visually
4. **Copy** the generated message to use with your own bot, or **Send** it directly via Tailscale/Telegram ([Settings](https://monadly.xyz/openclaw/settings))

The Command Center generates the exact message format documented in `monadly-core_SKILL.md` (see "Strategy Activation Flow"). It's a visual builder for the same commands you'd type manually.

---

## Repository Structure

```
OpenClaw/
  skills/                    # AI agent instruction files
    monadly-core_SKILL.md      Core orchestrator & strategy engine
    lfj-liquidity_SKILL.md     LFJ Liquidity Book positions
    clmm-liquidity_SKILL.md    Uniswap V4 & PancakeSwap CLMM
    security-hardening_SKILL.md Defense & incident response
    kuru-swap_SKILL.md          Kuru Flow token swaps
    kuru-liquidity_SKILL.md     Kuru AMM Vault deposits
  src/                       # Dashboard & transport source code
    LombesterDashboard.tsx     Lobster Command Center UI
    settings-page.tsx          OpenClaw settings page
    useBotCommand.ts           Message transport (Tailscale/Telegram)
    useOpenClawConfig.ts       Config persistence hook
    telegram-proxy.ts          Server-side Telegram relay
  generators/                # Data generators
    pools-md.ts                Pool rankings generator (openclaw.txt)
  protocol.md                # Wire protocol specification
  openclaw-manager.md         # Bot lifecycle management
```

---

## Live Data Feed — `openclaw.txt`

The agent's primary data source is [monadly.xyz/openclaw.txt](https://monadly.xyz/openclaw.txt) — a markdown file generated every 10 minutes from Monadly's aggregated on-chain data. It contains:

- **Top 10 by Bestly Score** — 7-day real return after impermanent loss. Positive = LPs made money.
- **Top 10 by APR** — Highest raw yield (with warnings about IL risk).
- **Top 10 by TVL** — Most liquid, safest pools.
- **Notes for AI Agents** — How to interpret the data, suggested actions, data freshness.

Each pool entry includes: pair name, DEX, Bestly 7D return, APR, TVL, and deposit link. The file is markdown because LLMs read it naturally without parsing — the agent reasons about the rankings directly.

The generator that produces this file is [`generators/pools-md.ts`](generators/pools-md.ts).

---

## How the Bot Runs Autonomously

When you send a strategy from the Command Center, the bot enters a continuous monitoring loop:

1. **Fetch rankings** from [monadly.xyz/openclaw.txt](https://monadly.xyz/openclaw.txt) (updated every 10 minutes)
2. **Check positions** — are they still in the top N? Are they in range?
3. **Rotate pools** — if a pool drops out of the top N for 2+ consecutive checks, exit and enter the new top pool (with anti-thrashing buffers)
4. **Rebalance** — re-center positions that have drifted out of range
5. **Report** — send status updates via Telegram (every cycle or actions-only)
6. **Sleep** — wait for the configured check interval, then repeat

The full decision tree is documented in `monadly-core_SKILL.md` under "Strategy Monitoring Cycle".

---

## Safety

OpenClaw is built with defense-in-depth:

- **Always simulate before executing** — `cast estimate` before every `cast send`
- **Never approve unlimited** — exact token amounts only, never `type(uint256).max`
- **Gas safety cap** — strategy auto-pauses if gas spending exceeds 10% of smallest position value
- **Pre-flight checks** — 13-point verification before every transaction (balance, gas, address, chain ID, etc.)
- **User confirmation** — the bot always shows what it will do and asks before executing
- **Incident response** — `security-hardening_SKILL.md` includes a full playbook for compromised keys, suspicious transactions, and emergency procedures

---

## Source Code Auditing

Every file in this repository is the actual production code running on [monadly.xyz](https://monadly.xyz). The `src/` directory contains the React components that power the Lobster Command Center — you can read exactly how your strategy messages are built and sent.

Key files for auditors:
- [`LombesterDashboard.tsx`](src/LombesterDashboard.tsx) — How the UI builds strategy messages (`buildDeployMessage()`)
- [`useBotCommand.ts`](src/useBotCommand.ts) — How messages are transported to the bot
- [`protocol.md`](protocol.md) — The wire protocol between UI and bot
- [`monadly-core_SKILL.md`](skills/monadly-core_SKILL.md) — How the bot parses and executes strategy messages

---

## Links

- **Dashboard**: [monadly.xyz](https://monadly.xyz)
- **Pool Rankings**: [monadly.xyz/openclaw.txt](https://monadly.xyz/openclaw.txt)
- **Settings**: [monadly.xyz/openclaw/settings](https://monadly.xyz/openclaw/settings)
- **About**: [monadly.xyz/openclaw](https://monadly.xyz/openclaw)

---

## License

Proprietary. All rights reserved by [Monadly](https://monadly.xyz).
