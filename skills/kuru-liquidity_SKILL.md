---
name: kuru-liquidity
description: |
  Deploy and manage liquidity in Kuru AMM Vaults on Monad.
  Kuru vaults are ERC20-based AMM pools with automatic market-making —
  no range or bin configuration required. Just deposit base + quote tokens.
  Use when the user wants to add/remove liquidity on Kuru pools.
  ALWAYS run monadly-core pre-flight checks before any transaction.
user-invocable: true
source: https://github.com/Monadly/OpenClaw/blob/main/skills/kuru-liquidity_SKILL.md
metadata: {"openclaw": {"requires": {"bins": ["cast", "bc"]}, "primaryEnv": "MONAD_RPC_URL"}}
---

# Kuru Liquidity Skill — AMM Vault Deposits on Monad

You manage liquidity positions in **Kuru AMM Vaults** on Monad (Chain ID: 143) using Monad Foundry's `cast` CLI — never the Kuru TypeScript SDK, ethers.js, viem, or any JS library.

## How Kuru Vaults Work

Kuru vaults are **NOT concentrated liquidity** — there are no ticks, bins, or ranges.
Each vault is an ERC20 token. When you deposit, you receive vault shares.
The vault automatically places orders on Kuru's CLOB (order book) with a configured spread.
Trading fees accrue directly to vault reserves, automatically benefiting all LP share holders.

**Key difference from LFJ/Uniswap/PancakeSwap:**
- No range selection needed — the vault manages its own bid/ask spread
- No rebalancing needed — the vault handles position management
- No tick/bin math — just deposit base + quote tokens proportionally
- Withdrawal returns proportional base + quote tokens

## Contract Addresses (Monad Mainnet)

| Contract | Address |
|----------|---------|
| **MarginAccount** | `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5` |
| Router (market factory) | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` |

### Known Vaults

| Pair | Vault Address |
|------|---------------|
| MON/AUSD | `0x4869A4C7657cEf5E5496C9cE56DDe4CD593e4923` |

New vaults appear in Merkl and in `openclaw.txt` rankings as Kuru pools.
ALWAYS verify vault addresses against on-chain data before depositing.

## Token Addresses

| Token | Address | Decimals |
|-------|---------|----------|
| Native MON | `0x0000000000000000000000000000000000000000` | 18 |
| WMON | `0x3bd359C1119dA7Da1D913D1c4D2b7c461115433A` | 18 |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 18 |

---

## Vault Function Signatures

### Read Functions (no gas, view-only)

```bash
# Preview how many shares you get for a deposit
cast call "$VAULT" "previewDeposit(uint256,uint256)(uint256)" "$BASE_AMOUNT" "$QUOTE_AMOUNT" --rpc-url "$MONAD_RPC_URL"

# Preview how much base+quote you need for exact shares
cast call "$VAULT" "previewMint(uint256)(uint256,uint256)" "$SHARES" --rpc-url "$MONAD_RPC_URL"

# Preview how much base+quote you get for burning shares
cast call "$VAULT" "previewWithdraw(uint256)(uint256,uint256)" "$SHARES" --rpc-url "$MONAD_RPC_URL"

# Get total vault reserves
cast call "$VAULT" "totalAssets()(uint256,uint256)" --rpc-url "$MONAD_RPC_URL"

# Get your share balance
cast call "$VAULT" "balanceOf(address)(uint256)" "$WALLET_ADDRESS" --rpc-url "$MONAD_RPC_URL"

# Get total shares outstanding
cast call "$VAULT" "totalSupply()(uint256)" --rpc-url "$MONAD_RPC_URL"

# Get vault's token addresses
cast call "$VAULT" "token1()(address)" --rpc-url "$MONAD_RPC_URL"
cast call "$VAULT" "token2()(address)" --rpc-url "$MONAD_RPC_URL"
```

### Write Functions

```bash
# Deposit base + quote tokens → receive shares
cast send "$VAULT" "deposit(uint256,uint256,uint256,address)" \
  "$BASE_AMOUNT" "$QUOTE_AMOUNT" "$MIN_QUOTE_CONSUMED" "$RECEIVER" \
  --value "$ETH_VALUE" \
  --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL"

# Mint exact number of shares (vault pulls needed tokens)
cast send "$VAULT" "mint(uint256,address)" \
  "$SHARES" "$RECEIVER" \
  --value "$ETH_VALUE" \
  --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL"

# Withdraw by burning shares → receive base + quote
cast send "$VAULT" "withdraw(uint256,address,address)" \
  "$SHARES" "$RECEIVER" "$OWNER" \
  --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL"
```

---

## Deposit Workflow

### Step 1 — Verify Vault

```bash
VAULT="0x4869A4C7657cEf5E5496C9cE56DDe4CD593e4923"

# Confirm token addresses match expected pair
TOKEN1=$(cast call "$VAULT" "token1()(address)" --rpc-url "$MONAD_RPC_URL")
TOKEN2=$(cast call "$VAULT" "token2()(address)" --rpc-url "$MONAD_RPC_URL")
echo "Token1 (base): $TOKEN1"
echo "Token2 (quote): $TOKEN2"
```

Cross-check addresses against the Token Addresses table above.

### Step 2 — Check Current Vault State

```bash
# Total reserves
RESERVES=$(cast call "$VAULT" "totalAssets()(uint256,uint256)" --rpc-url "$MONAD_RPC_URL")
echo "Reserves: $RESERVES"

# Total shares
TOTAL_SUPPLY=$(cast call "$VAULT" "totalSupply()(uint256)" --rpc-url "$MONAD_RPC_URL")
echo "Total shares: $TOTAL_SUPPLY"
```

### Step 3 — Preview Deposit

```bash
# How many shares will I get for my deposit?
SHARES=$(cast call "$VAULT" "previewDeposit(uint256,uint256)(uint256)" \
  "$BASE_AMOUNT" "$QUOTE_AMOUNT" --rpc-url "$MONAD_RPC_URL")
echo "Expected shares: $SHARES"
```

### Step 4 — Approve Tokens

For each ERC20 token being deposited (skip for native MON):

```bash
# Check current allowance
ALLOWANCE=$(cast call "$TOKEN" "allowance(address,address)(uint256)" \
  "$WALLET_ADDRESS" "$VAULT" --rpc-url "$MONAD_RPC_URL")

# Approve exact amount if needed (use bc for uint256 comparison)
if [ "$(echo "$ALLOWANCE < $AMOUNT" | bc)" -eq 1 ]; then
  cast send "$TOKEN" "approve(address,uint256)" "$VAULT" "$AMOUNT" \
    --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL"
fi
```

### Step 5 — Simulate Deposit

```bash
# Set minQuoteConsumed to 95% of quoteDeposit for 5% slippage tolerance
MIN_QUOTE=$(echo "$QUOTE_AMOUNT * 95 / 100" | bc)

# If base token is native MON, set --value; otherwise 0
ETH_VALUE=0  # or "$BASE_AMOUNT" if base is native MON

cast estimate "$VAULT" \
  "deposit(uint256,uint256,uint256,address)" \
  "$BASE_AMOUNT" "$QUOTE_AMOUNT" "$MIN_QUOTE" "$WALLET_ADDRESS" \
  --value "$ETH_VALUE" \
  --from "$WALLET_ADDRESS" --rpc-url "$MONAD_RPC_URL"
```

### Step 6 — Execute Deposit (ONLY after user confirmation)

```bash
TX_HASH=$(cast send "$VAULT" \
  "deposit(uint256,uint256,uint256,address)" \
  "$BASE_AMOUNT" "$QUOTE_AMOUNT" "$MIN_QUOTE" "$WALLET_ADDRESS" \
  --value "$ETH_VALUE" \
  --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL" \
  --json | jq -r '.transactionHash')
echo "Deposit tx: $TX_HASH"
```

### Step 7 — Verify

```bash
# Check share balance
NEW_SHARES=$(cast call "$VAULT" "balanceOf(address)(uint256)" "$WALLET_ADDRESS" --rpc-url "$MONAD_RPC_URL")
echo "Shares held: $NEW_SHARES"

# Preview what those shares are worth
cast call "$VAULT" "previewWithdraw(uint256)(uint256,uint256)" "$NEW_SHARES" --rpc-url "$MONAD_RPC_URL"
```

---

## Withdrawal Workflow

### Step 1 — Check Position

```bash
SHARES=$(cast call "$VAULT" "balanceOf(address)(uint256)" "$WALLET_ADDRESS" --rpc-url "$MONAD_RPC_URL")
echo "Shares: $SHARES"

# Preview withdrawal amounts
cast call "$VAULT" "previewWithdraw(uint256)(uint256,uint256)" "$SHARES" --rpc-url "$MONAD_RPC_URL"
```

### Step 2 — Simulate Withdrawal

```bash
cast estimate "$VAULT" \
  "withdraw(uint256,address,address)" \
  "$SHARES" "$WALLET_ADDRESS" "$WALLET_ADDRESS" \
  --from "$WALLET_ADDRESS" --rpc-url "$MONAD_RPC_URL"
```

### Step 3 — Execute (ONLY after user confirmation)

```bash
cast send "$VAULT" \
  "withdraw(uint256,address,address)" \
  "$SHARES" "$WALLET_ADDRESS" "$WALLET_ADDRESS" \
  --private-key "$PRIVATE_KEY" --rpc-url "$MONAD_RPC_URL"
```

### Step 4 — Verify

Check base + quote token balances increased. Record position exit in positions.json.

---

## Position State (positions.json)

```json
{
  "pool": "MON/AUSD",
  "dex": "kuru",
  "type": "vault",
  "vaultAddress": "0x4869A4C7657cEf5E5496C9cE56DDe4CD593e4923",
  "shares": "1500000000000000000",
  "depositBase": "1000000000000000000",
  "depositQuote": "500000",
  "depositTxHash": "0x...",
  "depositedAt": "2026-02-15T12:00:00Z",
  "source": "strategy"
}
```

**No range fields** — vaults don't use ranges. The `type: "vault"` field distinguishes this from range-based positions.

---

## Safety Rules

1. **ALWAYS verify vault address** — Cross-check token1/token2 match expected pair
2. **ALWAYS simulate first** — `cast estimate` before `cast send`
3. **ALWAYS preview deposit** — `previewDeposit` to see expected shares before committing
4. **NEVER approve unlimited** — Approve exact amounts, never `type(uint256).max`
5. **ALWAYS set minQuoteConsumed** — Use 95% of quoteDeposit for 5% slippage protection
6. **ALWAYS confirm with user** — Show expected shares and current vault state
7. **ALWAYS keep gas reserve** — Minimum 10 MON after deposit
8. **NEVER expose keys** — Use `$PRIVATE_KEY` env var, never inline
9. **First deposit caution** — First depositor loses MIN_LIQUIDITY (10^3) shares to margin account
10. **Check withdrawal ratios** — Due to trading, withdrawal base:quote ratio may differ from deposit

## Key Differences from Range-Based Skills

| Feature | LFJ / CLMM | Kuru Vault |
|---------|-------------|------------|
| Range selection | Required (bins/ticks) | Not applicable |
| Rebalancing | Manual or agent-managed | Automatic (vault handles spread) |
| Position token | NFT or bin receipts | ERC20 shares |
| Fee collection | Explicit claim | Auto-accrued to reserves |
| IL exposure | Within range only | Full range (like Uniswap V2) |
| Deploy complexity | High (calculate bins/ticks) | Low (just deposit amounts) |

## Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `cast estimate` reverts | Insufficient balance or bad params | Check balances, verify amounts |
| Shares = 0 | Deposit amounts too small | Increase deposit amounts |
| `previewDeposit` returns 0 | Vault may be paused or empty | Check vault state, verify address |
| Withdrawal returns less than expected | Price moved since deposit (IL) | Normal for AMM vaults, not an error |
