---
name: kuru-swap
description: |
  Execute token swaps on Monad via Kuru Flow aggregator.
  Kuru Flow routes through all Kuru CLOB markets to find optimal swap paths.
  Use when the user wants to swap, trade, exchange, or convert any token on Monad.
  Handles native MON, WMON, USDC, AUSD, and any ERC20 token listed on Kuru.
  ALWAYS run monadly-core pre-flight checks before any transaction.
user-invocable: true
source: https://github.com/Monadly/OpenClaw/blob/main/skills/kuru-swap_SKILL.md
metadata: {"openclaw": {"requires": {"bins": ["cast", "curl", "jq"]}, "primaryEnv": "MONAD_RPC_URL"}}
---

# Kuru Swap Skill — Token Swaps on Monad

You execute token swaps on Monad (Chain ID: 143) through the **Kuru Flow** aggregator.
You use `curl` for API calls and Monad Foundry's `cast` CLI for on-chain interactions.
You NEVER use the Kuru TypeScript SDK, ethers.js, viem, or any JS library.
Everything goes through `curl`, `cast`, and `jq` commands in the shell.

## How Kuru Works

Kuru is a **CLOB (Central Limit Order Book)** DEX — not an AMM. Each market is an on-chain
order book with discrete price levels plus a backstop AMM (discretized CPAMM) providing
baseline liquidity.

**Kuru Flow** is the aggregator layer. It:
- Indexes all liquidity sources on Monad in real time
- Finds the best multi-hop route for any token pair
- Returns a ready-to-submit transaction (calldata + value + target contract)

You do NOT need to know market addresses, order book mechanics, or routing logic.
The API handles all of that. You just submit the transaction it gives you.

## Contract Addresses (Monad Mainnet)

| Contract | Address |
|----------|---------|
| **KuruFlowEntrypoint** (all swaps go here) | `0xb3e6778480b2E488385E8205eA05E20060B813cb` |
| KuruFlowRouter | `0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2` |
| Router (market factory) | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` |
| MarginAccount | `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5` |

## Official Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| Native MON | `0x0000000000000000000000000000000000000000` | 18 |
| WMON | `0x3bd359C1119dA7Da1D913D1c4D2b7c461115433A` | 18 |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 18 |

Native MON uses the zero address in API calls. The API handles WMON wrapping automatically.
For tokens NOT listed here, the user must provide the contract address. NEVER guess addresses.

## API Endpoints

| Endpoint | Method | URL | Auth |
|----------|--------|-----|------|
| Generate JWT | POST | `https://ws.kuru.io/api/generate-token` | None |
| Get Quote | POST | `https://ws.kuru.io/api/quote` | Bearer JWT |

Rate limit: **1 request per second**. Add `sleep 1` between consecutive API calls.

---

## Swap Workflow

### Step 1 — Get JWT Token

```bash
KURU_JWT=$(curl -s --request POST \
  --url 'https://ws.kuru.io/api/generate-token' \
  --header 'Content-Type: application/json' \
  --data "{\"user_address\": \"$WALLET_ADDRESS\"}" \
  | jq -r '.token')
```

- No API key needed — just a wallet address
- Valid ~24 hours. Cache it: `echo "$KURU_JWT" > ~/.openclaw/kuru-jwt.tmp`
- Do NOT regenerate per swap

### Step 2 — Get Quote

```bash
QUOTE=$(curl -s --request POST \
  --url 'https://ws.kuru.io/api/quote' \
  --header "Authorization: Bearer $KURU_JWT" \
  --header 'Content-Type: application/json' \
  --data "{
    \"userAddress\": \"$WALLET_ADDRESS\",
    \"tokenIn\": \"$TOKEN_IN\",
    \"tokenOut\": \"$TOKEN_OUT\",
    \"amount\": \"$AMOUNT_WEI\",
    \"slippageTolerance\": $SLIPPAGE_BPS,
    \"autoSlippage\": false
  }")
```

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userAddress` | string | YES | Wallet executing the swap |
| `tokenIn` | string | YES | Token to sell (`0x000...000` for native MON) |
| `tokenOut` | string | YES | Token to buy (`0x000...000` for native MON) |
| `amount` | string | YES | Amount in smallest unit (wei / raw units) |
| `slippageTolerance` | int | NO | Basis points: 50 = 0.5%, 100 = 1%. Range 1-10000 |
| `autoSlippage` | bool | YES | `true` lets Kuru pick optimal slippage |
| `referrerAddress` | string | NO | Optional referrer for fee sharing |
| `referrerFeeBps` | int | NO | Optional referrer fee in basis points |

**Response fields:**

| Field | Description |
|-------|-------------|
| `status` | `"success"` or `"error"` |
| `output` | Expected output amount (smallest unit of tokenOut) |
| `minOut` | Minimum output after slippage |
| `transaction.to` | Contract to call (KuruFlowEntrypoint) |
| `transaction.calldata` | Hex calldata — **NO `0x` prefix**. You MUST prepend `0x` for cast |
| `transaction.value` | Wei to send (non-zero only for native MON input) |
| `gasPrices` | `{slow, standard, fast, rapid, extreme}` in gwei |

### Step 3 — Execute

**3a. Extract transaction fields:**
```bash
STATUS=$(echo "$QUOTE" | jq -r '.status')
if [ "$STATUS" != "success" ]; then
  echo "ERROR: $(echo "$QUOTE" | jq -r '.message // .error')" && exit 1
fi

TX_TO=$(echo "$QUOTE" | jq -r '.transaction.to')
TX_CALLDATA=$(echo "$QUOTE" | jq -r '.transaction.calldata')
TX_VALUE=$(echo "$QUOTE" | jq -r '.transaction.value')
OUTPUT=$(echo "$QUOTE" | jq -r '.output')
MIN_OUT=$(echo "$QUOTE" | jq -r '.minOut')
```

**3b. For ERC20 input — approve first (skip for native MON):**
```bash
KURU_ENTRYPOINT="0xb3e6778480b2E488385E8205eA05E20060B813cb"

ALLOWANCE=$(cast call "$TOKEN_IN" \
  "allowance(address,address)(uint256)" \
  "$WALLET_ADDRESS" "$KURU_ENTRYPOINT" \
  --rpc-url "$MONAD_RPC_URL")

if [ "$ALLOWANCE" -lt "$AMOUNT_WEI" ]; then
  cast send "$TOKEN_IN" "approve(address,uint256)" \
    "$KURU_ENTRYPOINT" "$AMOUNT_WEI" \
    --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL"
fi
```

**3c. Simulate (always do this before sending):**
```bash
GAS=$(cast estimate "$TX_TO" "0x${TX_CALLDATA}" \
  --value "$TX_VALUE" \
  --from "$WALLET_ADDRESS" \
  --rpc-url "$MONAD_RPC_URL")
echo "Gas estimate: $GAS"
```

**3d. Send (ONLY after user confirmation):**
```bash
cast send "$TX_TO" "0x${TX_CALLDATA}" \
  --value "$TX_VALUE" \
  --private-key "$PRIVATE_KEY" \
  --rpc-url "$MONAD_RPC_URL"
```

---

## Amount Conversions

| Token | Decimals | 1 token in smallest unit |
|-------|----------|--------------------------|
| MON / WMON / AUSD | 18 | `1000000000000000000` |
| USDC | 6 | `1000000` |

```bash
# Human → wei (18 decimals)
cast to-wei 0.5                          # → 500000000000000000

# Human → raw (6 decimals, e.g. USDC)
echo "5 * 1000000" | bc                  # → 5000000

# Wei → human (18 decimals)
cast from-wei 55062512840247733585       # → ~55.06

# Raw → human (6 decimals)
echo "scale=6; 181 / 1000000" | bc       # → 0.000181
```

## Slippage Guidelines

| Scenario | BPS | Notes |
|----------|-----|-------|
| Stablecoins (USDC↔AUSD) | 10-30 | Very tight |
| Major pairs (MON↔USDC) | 50-100 | Safe default |
| Low-liquidity tokens | 200-500 | Wider to avoid reverts |

**Default: `100` (1%) unless the user says otherwise.**

## Balance Checks

```bash
# Native MON
cast balance "$WALLET_ADDRESS" --rpc-url "$MONAD_RPC_URL"

# ERC20 (e.g. USDC)
cast call "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" \
  "balanceOf(address)(uint256)" "$WALLET_ADDRESS" \
  --rpc-url "$MONAD_RPC_URL"
```

Always check balances before AND after a swap to verify execution.

## Safety Rules

1. **ALWAYS simulate first** — `cast estimate` before `cast send`
2. **NEVER approve unlimited** — Approve exact `$AMOUNT_WEI`, never `type(uint256).max`
3. **NEVER skip slippage** — Always set `slippageTolerance` or `autoSlippage: true`
4. **ALWAYS verify quote status** — Check `status == "success"` before proceeding
5. **ALWAYS confirm with user** — Show expected output, ask for go-ahead before executing
6. **ALWAYS keep gas reserve** — Minimum 10 MON must remain after the swap
7. **NEVER expose keys** — Use `$PRIVATE_KEY` env var, never inline
8. **ALWAYS verify token addresses** — Cross-check against the table above or user confirmation
9. **ALWAYS check input balance** — Verify balance >= swap amount before executing
10. **Rate limit** — 1 req/sec on Kuru Flow. Add `sleep 1` between API calls

## Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid_auth_format` | Bad auth header | Use `Authorization: Bearer <token>` (with space after Bearer) |
| `token_expired` | JWT expired | Re-generate via `/api/generate-token` |
| `rate_limited` | >1 req/sec | Add `sleep 1` between calls |
| Quote `status: "error"` | No route / insufficient liquidity | Smaller amount, different pair, wider slippage |
| `cast estimate` fails | Tx would revert on-chain | Stale quote — re-fetch and retry |
| Gas >2M | Complex multi-hop route | Normal for 3+ hops. Verify quote is fresh |

## Limitations

- **API dependency** — Swaps need `ws.kuru.io` reachable. No pure on-chain fallback in this skill.
- **Rate limit** — 1 req/sec per JWT. Add delays for batch operations.
- **Token coverage** — Only tokens with Kuru markets can be swapped.
- **Quote staleness** — Quotes expire in seconds. Always get a fresh quote right before executing.
- **No limit orders** — This skill covers market swaps only.
