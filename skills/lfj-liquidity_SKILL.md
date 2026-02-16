---
name: lfj-liquidity
description: |
  Execute liquidity operations on LFJ (Liquidity Book / Trader Joe) DEX on Monad (Chain ID: 143).
  Add, remove, and rebalance liquidity positions using Monad Foundry's cast CLI. Includes all LFJ V2.2
  contract addresses and function signatures, bin math (price-to-binId conversion), 4 distribution
  strategies (uniform, concentrated, wide, user-defined), full step-by-step cast command examples,
  and 9 LFJ-specific safety rules. Use when: the user mentions LFJ, Liquidity Book, bins, bin step,
  Trader Joe, LP tokens, adding/removing liquidity, or rebalancing on Monad. Requires monadly-core
  pre-flight checks before any write transaction. Not for: non-LFJ DEXes, wallet setup, monitoring
  logic, or portfolio management (those are in monadly-core).
user-invocable: true
source: https://github.com/Monadly/OpenClaw/blob/main/skills/lfj-liquidity_SKILL.md
metadata: {"openclaw": {"requires": {"bins": ["cast"]}, "primaryEnv": "MONAD_RPC_URL"}}
---

# LFJ Liquidity Skill -- Liquidity Book on Monad

You manage liquidity positions on LFJ's Liquidity Book (LB) DEX on Monad (Chain ID: 143).
You use Monad Foundry's `cast` CLI for all on-chain interactions. You NEVER use viem, ethers.js, or
any other JS library directly -- everything goes through `cast` commands in the shell.

## Index

**This is a large file (~2,300 lines).** Use this index to jump to the section you need.

### Concepts & Reference
| Section | What it covers |
|---------|---------------|
| [Overview: Liquidity Book vs AMMs](#overview-liquidity-book-vs-amms) | How LB works: bins, composition fees, active bin, ERC-1155 LP tokens |
| [Contract Addresses & Function Signatures](#contract-addresses--function-signatures) | Router, Factory, Quoter, Helper, known pools, token addresses, all ABIs |
| [Bin Math & Distribution Strategies](#bin-math--distribution-strategies) | Price↔binId formula, 4 strategies (uniform, concentrated, wide, custom) |
| [Environment Variables](#environment-variables) | Required env vars |

### Operations (Read → Add → Remove → Rebalance)
| Section | What it covers |
|---------|---------------|
| [Reading Pool State](#reading-pool-state) | 5 read operations: active bin, price, reserves, LP balance, total supply |
| [Adding Liquidity — Full Workflow](#adding-liquidity----full-workflow) | 9-step workflow with all cast commands |
| [Removing Liquidity — Full Workflow](#removing-liquidity----full-workflow) | 5-step workflow |
| [Rebalancing — Complete Cycle](#rebalancing----complete-cycle) | When and how to rebalance (remove + add) |

### Safety, Commands & Examples
| Section | What it covers |
|---------|---------------|
| [Safety Rules (LFJ-Specific)](#safety-rules-lfj-specific) | 9 rules: composition, `--value`, distribution sums, simulate-first, etc. |
| [Command Mapping](#command-mapping-from-monadly-ui) | Monadly UI command → skill action routing |
| [Step-by-Step Examples](#step-by-step-examples) | 6 complete examples with full cast commands |
| [Common Pitfalls and Debugging](#common-pitfalls-and-debugging) | Troubleshooting guide |

---

## Overview: Liquidity Book vs AMMs

LFJ's Liquidity Book is fundamentally different from Uniswap-style AMMs:

- **Bins, not ticks.** Liquidity is deposited into discrete price bins. Each bin has a fixed
  price determined by its ID. There is no continuous curve.
- **Constant sum within bins.** Each bin uses the formula `L = P * x + y` (constant sum, NOT
  constant product). This means swaps within a single bin happen at zero slippage. Slippage
  only occurs when a swap crosses from one bin to the next.
- **Active bin.** Only one bin is "active" at any time -- this is where trading happens and
  where the current market price lives. The active bin can hold both tokens.
- **Bin step.** Each pool has a fixed bin step (in basis points). A bin step of 10 means each
  bin's price is 0.10% higher or lower than its neighbor.
- **LP tokens are per-bin.** You receive separate LP token balances for each bin you deposit into.
  LP tokens follow the ERC-1155 standard (multi-token), not ERC-20. All LPs in the same bin
  share fungible tokens (unlike Uniswap V3's NFT positions).
- **Composition rule.** Bins below the active bin hold ONLY token Y (quote token, e.g., USDC).
  Bins above the active bin hold ONLY token X (base token, e.g., WMON). The active bin can
  hold both tokens -- its current split is called the **composition factor** (`c = y / L`).

### Composition Fees (CRITICAL concept)

When you deposit into the **active bin**, the protocol compares your deposit's token ratio to the
bin's current composition. If they differ, you are charged a **composition fee**.

**Why?** Without this fee, someone could deposit 100% token X into the active bin, receive LP
tokens, then immediately withdraw to get back a proportional mix of BOTH tokens -- effectively
executing a swap without paying any swap fee. The composition fee prevents this exploit.

**When composition fees apply:**
- ONLY on deposits into the **active bin** where your ratio differs from the bin's current ratio
- NEVER on bins above or below active (those are single-token by definition, no ratio mismatch)
- The fee ≈ `implicitSwapAmount × totalFee × (1 + totalFee)` (slightly higher than a normal swap)

**What this means for you:**
- Depositing both tokens into the active bin matching its current ratio = **lowest cost**
- Depositing single-sided into the active bin = **works but costs more** (composition fee)
- Depositing single-sided into bins above/below active = **no composition fee**
- The lb-rebalancer always deposits both tokens with a 50/50 value split, which minimizes fees

**Implication:** When constructing distribution arrays, you MUST respect the composition rule
(no token X below active, no token Y above active). For the active bin, you CAN deposit any
ratio, but a balanced deposit minimizes composition fees.

## Contract Addresses & Function Signatures

All addresses are for Monad mainnet (Chain ID: 143).

### Contract Addresses

| Contract | Address | Purpose |
|----------|---------|---------|
| LBRouter V2.2 | `0x18556DA13313f3532c54711497A8FedAC273220E` | Add/remove liquidity, swaps |
| LBFactory V2.2 | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | Discover pool addresses |
| LBQuoter | `0xf57B8a91F775B01d53450D7Cb4D2A99Ba989fd19` | Quote swap amounts |
| LiquidityHelper | `0xA5c68C9E55Dde3505e60c4B5eAe411e2977dfB35` | Batch read helper |

### Known Pool Addresses

| Pair | Bin Step | Address |
|------|----------|---------|
| MON/USDC | 10 | `0x5E60BC3F7a7303BC4dfE4dc2220bdC90bc04fE22` |

### Token Addresses

| Token | Address | Decimals |
|-------|---------|----------|
| WMON | `0x3bd359c1119da7da1d913d1c4d2b7c461115433a` | 18 |
| USDC | `0x754704bc059f8c67012fed69bc8a327a5aafb603` | 6 |

To discover the WMON address dynamically from the router:

```bash
WMON=$(cast call 0x18556DA13313f3532c54711497A8FedAC273220E "getWNATIVE()(address)" --rpc-url $MONAD_RPC_URL)
echo "WMON address: $WMON"
```

### Discovering Pool Addresses via LBFactory

If you do not know the pool address for a token pair, query the factory:

```bash
# getLBPairInformation(tokenX, tokenY, binStep) returns (LBPair, binStep, version)
POOL_INFO=$(cast call 0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c \
  "getLBPairInformation(address,address,uint256)(address,uint256,uint256)" \
  $TOKEN_X_ADDRESS $TOKEN_Y_ADDRESS $BIN_STEP \
  --rpc-url $MONAD_RPC_URL)
echo "Pool info: $POOL_INFO"
```

The first return value is the pool (LBPair) address. If it returns `0x0000...0000`, no pool
exists for that pair at that bin step.

**NOTE:** Token ordering matters. If you get address(0), try swapping tokenX and tokenY.
Convention: token X = base token (e.g., WMON), token Y = quote token (e.g., USDC).

### Function Signatures

#### LBPair (Pool Contract)

##### getActiveId

Returns the current active bin ID where trading happens.

```
Signature: getActiveId()(uint24)
State: view
```

```bash
cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL
```

##### getBin

Returns reserves for a specific bin.

```
Signature: getBin(uint24 id)(uint128 binReserveX, uint128 binReserveY)
State: view
```

```bash
cast call $POOL "getBin(uint24)(uint128,uint128)" $BIN_ID --rpc-url $MONAD_RPC_URL
```

Returns two values: reserveX (token X amount), reserveY (token Y amount).

##### balanceOf

Returns LP token balance for a user in a specific bin. LP tokens are ERC-1155.

```
Signature: balanceOf(address account, uint256 id)(uint256)
State: view
```

```bash
cast call $POOL "balanceOf(address,uint256)(uint256)" $WALLET $BIN_ID --rpc-url $MONAD_RPC_URL
```

##### balanceOfBatch

Batch query for LP balances across multiple bins. More efficient than calling balanceOf in a loop.

```
Signature: balanceOfBatch(address[] accounts, uint256[] ids)(uint256[])
State: view
```

```bash
# Query multiple bins at once (same address repeated for each bin)
cast call $POOL \
  "balanceOfBatch(address[],uint256[])(uint256[])" \
  "[$WALLET,$WALLET,$WALLET]" \
  "[$BIN_1,$BIN_2,$BIN_3]" \
  --rpc-url $MONAD_RPC_URL
```

**Important:** The `accounts` array must be the same length as `ids`. Repeat your address once
per bin you are querying.

##### totalSupply

Returns total LP tokens minted for a specific bin. Used to calculate your share of reserves.

```
Signature: totalSupply(uint256 id)(uint256)
State: view
```

```bash
cast call $POOL "totalSupply(uint256)(uint256)" $BIN_ID --rpc-url $MONAD_RPC_URL
```

Your share of reserves = `(balanceOf / totalSupply) * binReserves`

##### approveForAll

Grants an operator (the router) permission to transfer your LP tokens. Required before removing liquidity.

```
Signature: approveForAll(address spender, bool approved)
State: nonpayable
```

```bash
# Grant approval
cast send $POOL "approveForAll(address,bool)" $LB_ROUTER true \
  --rpc-url $MONAD_RPC_URL --private-key $MONAD_PRIVATE_KEY

# Revoke approval (after operation completes)
cast send $POOL "approveForAll(address,bool)" $LB_ROUTER false \
  --rpc-url $MONAD_RPC_URL --private-key $MONAD_PRIVATE_KEY
```

##### isApprovedForAll

Check if an operator is currently approved for your LP tokens.

```
Signature: isApprovedForAll(address owner, address spender)(bool)
State: view
```

```bash
cast call $POOL "isApprovedForAll(address,address)(bool)" $WALLET $LB_ROUTER --rpc-url $MONAD_RPC_URL
```

##### getStaticFeeParameters

Returns the pool's fee configuration. Useful for understanding composition fee costs.

```
Signature: getStaticFeeParameters()(uint16 baseFactor, uint16 filterPeriod, uint16 decayPeriod, uint16 reductionFactor, uint24 variableFeeControl, uint16 protocolShare, uint24 maxVolatilityAccumulator)
State: view
```

```bash
cast call $POOL "getStaticFeeParameters()(uint16,uint16,uint16,uint16,uint24,uint16,uint24)" --rpc-url $MONAD_RPC_URL
```

The `baseFactor` and `binStep` determine the base fee: `baseFee = baseFactor × binStep × 1e-8`.
The `protocolShare` determines what fraction of fees go to the protocol (max 25%).

##### getTokenX / getTokenY

Returns the addresses of the two tokens in the pool.

```
Signature: getTokenX()(address)
Signature: getTokenY()(address)
State: view
```

```bash
TOKEN_X=$(cast call $POOL "getTokenX()(address)" --rpc-url $MONAD_RPC_URL)
TOKEN_Y=$(cast call $POOL "getTokenY()(address)" --rpc-url $MONAD_RPC_URL)
```

##### getBinStep

Returns the pool's bin step in basis points.

```
Signature: getBinStep()(uint16)
State: view
```

```bash
BIN_STEP=$(cast call $POOL "getBinStep()(uint16)" --rpc-url $MONAD_RPC_URL)
```

##### getPriceFromId

Returns the on-chain price for a bin ID (128.128 fixed-point format). Useful for verification
but the off-chain math formula is simpler for human-readable prices.

```
Signature: getPriceFromId(uint24 id)(uint256)
State: pure
```

```bash
cast call $POOL "getPriceFromId(uint24)(uint256)" $BIN_ID --rpc-url $MONAD_RPC_URL
```

#### LBRouter (Router Contract)

##### addLiquidityNATIVE

Adds liquidity using native MON (no need to wrap to WMON first). Takes a single tuple parameter.

```
Signature: addLiquidityNATIVE(
  (address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256)
)(uint256,uint256,uint256,uint256,uint256[],uint256[])
State: payable
```

**LiquidityParameters tuple fields (in order):**

| # | Field | Type | Description |
|---|-------|------|-------------|
| 0 | tokenX | address | Base token (WMON address, even though you send native MON) |
| 1 | tokenY | address | Quote token (e.g., USDC) |
| 2 | binStep | uint256 | Pool bin step (e.g., 10). NOTE: uint256 in the struct, not uint16! |
| 3 | amountX | uint256 | Amount of token X (MON) in wei |
| 4 | amountY | uint256 | Amount of token Y (USDC) in smallest unit |
| 5 | amountXMin | uint256 | Minimum token X accepted (slippage protection) |
| 6 | amountYMin | uint256 | Minimum token Y accepted (slippage protection) |
| 7 | activeIdDesired | uint256 | Expected active bin ID |
| 8 | idSlippage | uint256 | Max active bin movement allowed |
| 9 | deltaIds | int256[] | Bin offsets from active (e.g., [-2,-1,0,1,2]) |
| 10 | distributionX | uint256[] | Token X distribution per bin (sum to 100e18 = 1e20) |
| 11 | distributionY | uint256[] | Token Y distribution per bin (sum to 100e18 = 1e20) |
| 12 | to | address | LP token recipient |
| 13 | refundTo | address | Refund address for excess tokens |
| 14 | deadline | uint256 | Unix timestamp deadline |

**Return values:**

| # | Field | Type | Description |
|---|-------|------|-------------|
| 0 | amountXAdded | uint256 | Actual token X deposited |
| 1 | amountYAdded | uint256 | Actual token Y deposited |
| 2 | amountXLeft | uint256 | Token X refunded |
| 3 | amountYLeft | uint256 | Token Y refunded |
| 4 | depositIds | uint256[] | Bin IDs where liquidity was added |
| 5 | liquidityMinted | uint256[] | LP tokens minted per bin |

**CRITICAL:** The `--value` flag in `cast send` must equal `amountX` to send native MON.

##### swapExactNATIVEForTokens

Swaps native MON for an ERC20 token (e.g., USDC). Used to balance token holdings before
deploying liquidity.

```
Signature: swapExactNATIVEForTokens(
  uint256 amountOutMin,
  (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path,
  address to,
  uint256 deadline
)
State: payable
```

```bash
# Example: swap 5 MON for USDC (min output calculated from price quote)
cast send $LB_ROUTER \
  "swapExactNATIVEForTokens(uint256,(uint256[],uint8[],address[]),address,uint256)" \
  $MIN_AMOUNT_OUT \
  "([10],[2],[$WMON,$USDC])" \
  $MONAD_WALLET_ADDRESS \
  $(date -d '+10 minutes' +%s) \
  --value $(cast to-wei 5 ether) \
  --private-key $MONAD_PRIVATE_KEY \
  --rpc-url $MONAD_RPC_URL
```

**Path params:** `pairBinSteps` = bin step of the pool (e.g., 10), `versions` = LB version
(2 for V2.2), `tokenPath` = [fromToken, toToken]. For multi-hop, chain multiple entries.

##### swapExactTokensForNATIVE

Swaps an ERC20 token for native MON. Requires prior approval of the input token to the router.

```
Signature: swapExactTokensForNATIVE(
  uint256 amountIn,
  uint256 amountOutMinNATIVE,
  (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path,
  address to,
  uint256 deadline
)
State: nonpayable
```

```bash
# First approve the router to spend your tokens
cast send $USDC "approve(address,uint256)" $LB_ROUTER $AMOUNT \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL

# Then swap USDC for MON
cast send $LB_ROUTER \
  "swapExactTokensForNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)" \
  $AMOUNT_IN \
  $MIN_MON_OUT \
  "([10],[2],[$USDC,$WMON])" \
  $MONAD_WALLET_ADDRESS \
  $(date -d '+10 minutes' +%s) \
  --private-key $MONAD_PRIVATE_KEY \
  --rpc-url $MONAD_RPC_URL
```

##### removeLiquidityNATIVE

Removes liquidity and returns native MON (unwraps WMON automatically).

**IMPORTANT (V2.2):** This function takes only the **non-native token** address, NOT both tokens.
The router knows the native token via `getWNATIVE()`. This differs from V2.1 which took both tokenX and tokenY.

```
Signature: removeLiquidityNATIVE(
  address token,
  uint16 binStep,
  uint256 amountTokenMin,
  uint256 amountNATIVEMin,
  uint256[] ids,
  uint256[] amounts,
  address to,
  uint256 deadline
)(uint256 amountToken, uint256 amountNATIVE)
State: nonpayable
```

**Parameters:**

| # | Field | Type | Description |
|---|-------|------|-------------|
| 0 | token | address | The **non-native** token address (e.g., USDC). NOT WMON. |
| 1 | binStep | uint16 | Pool bin step |
| 2 | amountTokenMin | uint256 | Minimum non-native token to receive |
| 3 | amountNATIVEMin | uint256 | Minimum native MON to receive |
| 4 | ids | uint256[] | Absolute bin IDs to withdraw from |
| 5 | amounts | uint256[] | LP token amounts to burn per bin |
| 6 | to | address | Recipient (must be payable for native MON) |
| 7 | deadline | uint256 | Unix timestamp deadline |

**NOTE:** `ids` are ABSOLUTE bin IDs (not delta offsets). `amounts` are LP token balances,
NOT reserve amounts. The router calculates your share of reserves from the LP amount.

**REAL-WORLD LEARNED (2026-02-08):** When price moves through your bins, the token composition
changes. E.g., if you deposited MON into bins above active price and price rose past them,
those bins now hold USDC instead. Both token amounts are returned regardless of what you deposited.

##### getWNATIVE

Returns the wrapped native token address (WMON on Monad).

```
Signature: getWNATIVE()(address)
State: view
```

```bash
cast call $LB_ROUTER "getWNATIVE()(address)" --rpc-url $MONAD_RPC_URL
```

#### ERC-20 (Token Contract)

Standard functions used for token approvals and balance checks.

##### balanceOf

```
Signature: balanceOf(address account)(uint256)
State: view
```

##### approve

```
Signature: approve(address spender, uint256 amount)(bool)
State: nonpayable
```

**NEVER approve type(uint256).max.** Approve exactly 2x the needed amount.

##### allowance

```
Signature: allowance(address owner, address spender)(uint256)
State: view
```

##### decimals

```
Signature: decimals()(uint8)
State: view
```

##### symbol

```
Signature: symbol()(string)
State: view
```

### Quick Reference: cast Signatures

For copy-paste convenience, here are the exact `cast` function signature strings:

```bash
# Pool reads
"getActiveId()(uint24)"
"getBin(uint24)(uint128,uint128)"
"balanceOf(address,uint256)(uint256)"
"balanceOfBatch(address[],uint256[])(uint256[])"
"totalSupply(uint256)(uint256)"
"getTokenX()(address)"
"getTokenY()(address)"
"getBinStep()(uint16)"
"getPriceFromId(uint24)(uint256)"
"isApprovedForAll(address,address)(bool)"
"getStaticFeeParameters()(uint16,uint16,uint16,uint16,uint24,uint16,uint24)"

# Pool writes
"approveForAll(address,bool)"

# Router reads
"getWNATIVE()(address)"

# Router writes (addLiquidityNATIVE uses tuple syntax)
"addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))"
"removeLiquidityNATIVE(address,uint16,uint256,uint256,uint256[],uint256[],address,uint256)"
"swapExactNATIVEForTokens(uint256,(uint256[],uint8[],address[]),address,uint256)"
"swapExactTokensForNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)"

# ERC-20
"balanceOf(address)(uint256)"
"approve(address,uint256)(bool)"
"allowance(address,address)(uint256)"
"decimals()(uint8)"
"symbol()(string)"

# Factory
"getLBPairInformation(address,address,uint256)(address,uint256,uint256)"
```

## Bin Math & Distribution Strategies

### Bin Math Fundamentals

#### The Base Bin ID

Every Liquidity Book pool has a "base" bin at ID `8388608` (which is `2^23`). This bin
represents a raw price of exactly 1. All other bin IDs are relative to this base.

#### Bin ID to Price Conversion

The formula is:

```
rawPrice = (1 + binStep / 10000) ^ (binId - 8388608)
```

Where:
- `binStep` is in basis points (e.g., 10 = 0.10% per bin)
- `8388608` is the base bin ID (2^23)
- The exponent `(binId - 8388608)` can be negative (bins below base) or positive (above)

**Step-by-step example** for bin ID 8389000 with binStep 10:

1. Calculate the multiplier: `1 + 10/10000 = 1.001`
2. Calculate the exponent: `8389000 - 8388608 = 392`
3. Calculate raw price: `1.001^392 = 1.4784...`
4. This raw price is in token-native units (not adjusted for decimals yet)

#### Decimal Adjustment

The raw price from the formula is in the pool's internal representation. To get a human-readable
price (e.g., "52.34 USDC per MON"), you must adjust for the decimal difference between the two tokens:

```
humanPrice = rawPrice * 10^(decimalsX - decimalsY)
```

**Why?** Token X (e.g., WMON) has 18 decimals. Token Y (e.g., USDC) has 6 decimals. The pool
stores amounts in their smallest units (wei for MON, micro-units for USDC). The decimal
adjustment converts from the pool's internal ratio to the human-readable ratio.

**Examples:**

| Pair | decimalsX | decimalsY | Adjustment | Multiplier |
|------|-----------|-----------|------------|------------|
| MON/USDC | 18 | 6 | 18-6 = 12 | 10^12 |
| MON/WETH | 18 | 18 | 18-18 = 0 | 10^0 = 1 |
| WBTC/USDC | 8 | 6 | 8-6 = 2 | 10^2 = 100 |

**Full example** for MON/USDC at bin 8389000, binStep 10:

```
rawPrice = 1.001^(8389000 - 8388608) = 1.001^392 = 1.4784
humanPrice = 1.4784 * 10^(18-6) = 1.4784 * 10^12 = 1,478,400,000,000
```

Wait -- that does not look like a USD price. That is because the raw formula gives the price
of 1 wei of MON in micro-USDC units. To get "USDC per 1 MON":

```
pricePerMon = rawPrice * 10^(decimalsX - decimalsY)
```

With real numbers for a bin near the current MON price (~$52):

```
# If active bin is around 8388608 + log(52 / 10^12) / log(1.001)
# Solving: 52 / 10^12 = 1.001^exponent
# exponent = ln(52e-12) / ln(1.001) = ln(5.2e-11) / 0.0009995 = -23,660 (approx)
# binId = 8388608 + (-23660) = 8364948
```

In practice, you read the active bin from the pool and convert. You do not need to calculate
bin IDs from prices unless the user provides a target price.

#### Price to Bin ID Conversion (Reverse)

To find the nearest bin ID for a given human-readable price:

```
rawPrice = humanPrice / 10^(decimalsX - decimalsY)
exponent = ln(rawPrice) / ln(1 + binStep/10000)
binId = round(8388608 + exponent)
```

**Step-by-step** for "find the bin for $50 USDC/MON" (MON/USDC pool, binStep 10):

1. Remove decimal adjustment: `rawPrice = 50 / 10^12 = 5e-11`
2. Calculate log ratio: `exponent = ln(5e-11) / ln(1.001) = -23,697` (approx)
3. Add base: `binId = 8388608 + (-23697) = 8364911`
4. Round to nearest integer

### Composition Fees (Active Bin Deposits)

#### What They Are

When you deposit tokens into the **active bin**, the protocol checks if your deposit ratio
matches the bin's current composition. If it differs, you are charged a **composition fee** --
essentially the swap fee you would have paid to achieve that ratio through a regular swap.

#### Why They Exist

Without composition fees, you could exploit the protocol:
1. Deposit 100% token X into the active bin (which currently holds a mix of X and Y)
2. Receive LP tokens representing a proportional share of the bin
3. Immediately withdraw → get back a proportional mix of BOTH tokens
4. Net effect: you swapped some X for Y without paying any swap fee

The composition fee closes this exploit by charging you for the "implicit swap."

#### When They Apply

| Deposit Target | Composition Fee? | Why |
|----------------|-----------------|-----|
| Bins above active (deltaId > 0) | Never | Only token X allowed, no ratio mismatch possible |
| Bins below active (deltaId < 0) | Never | Only token Y allowed, no ratio mismatch possible |
| Active bin — matching current ratio | Minimal/zero | Your ratio matches, no implicit swap |
| Active bin — different ratio | Yes | Implicit swap detected, fee charged |
| Active bin — single-sided deposit | Yes (highest) | Maximum ratio mismatch |

#### The Fee Calculation

```
compositionFee ≈ implicitSwapAmount × totalFee × (1 + totalFee)
```

Where:
- `implicitSwapAmount` = the amount of token that would need to be swapped to match the ratio
- `totalFee` = baseFee + variableFee (the pool's current swap fee)
- The extra `(1 + totalFee)` multiplier makes composition fees slightly higher than normal swaps

#### How to Minimize Composition Fees

1. **Best: Match the bin's composition.** Read the active bin's reserves (`getBin`), calculate
   the current X/Y ratio, and deposit in that same ratio. This results in near-zero composition fees.

2. **Good: Use a 50/50 value split.** The lb-rebalancer does this. For most pools where the
   active bin is roughly balanced, this is close enough to minimize fees.

3. **Acceptable: Single-sided into active bin.** This works but pays the highest composition fee.
   Only do this when the user explicitly chooses single-sided deployment.

4. **Best for single-sided: Skip the active bin.** Deposit only into bins above (token X) or
   below (token Y) the active bin. Zero composition fees, but those bins earn zero trading fees
   until the price moves into them.

#### Reading the Active Bin's Current Composition

```bash
# Get reserves in the active bin
RESERVES=$(cast call $POOL_ADDRESS "getBin(uint24)(uint128,uint128)" $ACTIVE_ID --rpc-url $MONAD_RPC_URL)
RESERVE_X=$(echo "$RESERVES" | head -1)  # Token X reserves
RESERVE_Y=$(echo "$RESERVES" | tail -1)  # Token Y reserves

# The composition factor c = reserveY / (price * reserveX + reserveY)
# A high c means mostly token Y, a low c means mostly token X
# To match: deposit in the same reserveX:reserveY ratio
```

For the bot, the simplest approach is: read the active bin reserves, compute the ratio, and
split your deposit to match. This is more gas-efficient than paying composition fees.

---

### Distribution Array Construction

#### The Three Arrays

When calling `addLiquidityNATIVE`, you provide three arrays of equal length:

1. **deltaIds** (`int256[]`): Offset of each bin from the active bin. Example: `[-2, -1, 0, 1, 2]`
2. **distributionX** (`uint256[]`): How much of your token X goes into each bin
3. **distributionY** (`uint256[]`): How much of your token Y goes into each bin

#### The Composition Rule

This is the most important rule in Liquidity Book:

| Bin Position | Token X (base, e.g., MON) | Token Y (quote, e.g., USDC) |
|-------------|--------------------------|----------------------------|
| Below active (deltaId < 0) | 0 (FORBIDDEN — reverts) | Has distribution |
| Active bin (deltaId = 0) | Any amount (incl. 0) | Any amount (incl. 0) |
| Above active (deltaId > 0) | Has distribution | 0 (FORBIDDEN — reverts) |

**Why the rule exists:** Below the active bin, the price of X is "too high" -- no one would sell
X at that price. So those bins only hold Y (the quote token), waiting for the price to drop.
Above the active bin, the opposite: those bins only hold X, waiting for price to rise.

**The active bin is special:** It is the ONLY bin that can hold both tokens simultaneously.
You CAN deposit any ratio into it (even 100% of one token), but depositing a ratio that differs
from the bin's current composition triggers a **composition fee** (see Composition Fees section above).
For minimum cost, match the bin's current X/Y ratio.

#### Precision and Rounding

Each distribution array where any element is non-zero must sum to exactly **100e18**
(= 1e20 = 100000000000000000000). NOT 1e18! The LFJ SDK defines 100% = 100e18.

The value in each element represents that bin's percentage share. For example, if you have
5 bins with equal distribution, each gets `100e18 / 5 = 20000000000000000000` (= 20e18 = 20%).

**Rounding correction:** Integer division may leave a remainder. ALWAYS add the remainder to the
last non-zero element in each array:

```
numBins = 5
sharePerBin = floor(100e18 / 5) = 20000000000000000000
sum = 20000000000000000000 * 5 = 100000000000000000000  (exact, no correction needed)

numBins = 3
sharePerBin = floor(100e18 / 3) = 33333333333333333333
sum = 33333333333333333333 * 3 = 99999999999999999999  (off by 1!)
correction: last element += (100e18 - sum) = 33333333333333333334
```

**Algorithm to fix rounding for a distribution array:**

```
TOTAL = 100 * 10**18   # 100e18 = 1e20

sum = sum of all elements
if sum > 0 and sum < TOTAL:
    find the last index where element > 0
    element[lastIndex] += (TOTAL - sum)
```

Apply this fix SEPARATELY to distributionX and distributionY.

### Strategy: Uniform Distribution (lb-rebalancer approach)

The simplest strategy. Every bin gets an equal share.

**How it works:**
1. Choose N bins centered on the active bin
2. Each bin gets `100e18 / N` distribution weight (with rounding fix)
3. Respect the composition rule for X vs Y

**Algorithm:**

```
Given: activeId, numBins (must be odd for centering)
halfRange = (numBins - 1) / 2

For each bin from (activeId - halfRange) to (activeId + halfRange):
    deltaId = bin - activeId
    TOTAL = 100 * 10**18   # 100e18 = 1e20 (NOT 1e18!)
    sharePerBin = floor(TOTAL / numBins)

    if deltaId < 0:   # Below active — token Y ONLY (composition rule)
        distributionX.push(0)
        distributionY.push(sharePerBin)
    elif deltaId == 0: # Active bin — BOTH tokens (minimizes composition fees)
        distributionX.push(sharePerBin)
        distributionY.push(sharePerBin)
    else:              # Above active — token X ONLY (composition rule)
        distributionX.push(sharePerBin)
        distributionY.push(0)

# Fix rounding on both arrays (each must sum to exactly 100e18)
fixRounding(distributionX)
fixRounding(distributionY)
```

**Why both tokens in the active bin?** The active bin already holds a mix of both tokens.
Depositing both tokens to match its composition minimizes composition fees. If you only
deposited token X into the active bin, the protocol would charge a composition fee equal to
a swap fee on the implicit X→Y conversion.

**Example with 3 bins (the lb-rebalancer default):**

```
activeId = 8364948, numBins = 3
deltaIds = [-1, 0, 1]
TOTAL = 100e18 = 100000000000000000000
sharePerBin = floor(100e18 / 3) = 33333333333333333333

distributionX = [0, 33333333333333333333, 33333333333333333333]
distributionY = [33333333333333333333, 33333333333333333333, 0]

# Fix rounding:
# sumX = 66666666666666666666, need 100e18 - sumX = 33333333333333333334
# Last non-zero X index = 2 -> distributionX[2] += 33333333333333333334
# → distributionX[2] = 33333333333333333333 + 33333333333333333334 = 66666666666666666667
# sumY = 66666666666666666666, same correction
# Last non-zero Y index = 1 -> distributionY[1] = 66666666666666666667

Final:
distributionX = [0, 33333333333333333333, 66666666666666666667]
distributionY = [33333333333333333333, 66666666666666666667, 0]
# Verify: sumX = 0 + 33333333333333333333 + 66666666666666666667 = 100000000000000000000 ✓
# Verify: sumY = 33333333333333333333 + 66666666666666666667 + 0 = 100000000000000000000 ✓
```

**Tradeoffs:**
- Pros: Simple, predictable, equal exposure across all bins
- Cons: Capital spread thin across many bins, lower fee concentration
- Best for: Stable pairs, low-volatility markets, hands-off management

### Strategy: Concentrated (More Weight on Active Bin)

Puts more liquidity in and near the active bin, less on the edges.

**How it works:**
1. Assign weights based on distance from active bin
2. Active bin gets the highest weight, edges get the least
3. Normalize weights to sum to 100e18 (1e20)

**Weight formula (linear decay):**

```
weight(deltaId) = maxWeight - abs(deltaId) * decay
```

Where `maxWeight` and `decay` are chosen so the edge bins have at least some minimum weight.

**Example with 5 bins, concentrated:**

```
Weights: [1, 2, 4, 2, 1]  (active bin gets 4x edge weight)
Total weight = 10

deltaIds = [-2, -1, 0, 1, 2]

Raw shares (using 100e18 = 1e20 as total):
  bin -2: 1/10 * 100e18 = 10000000000000000000    (10e18 = 10%)
  bin -1: 2/10 * 100e18 = 20000000000000000000    (20e18 = 20%)
  bin  0: 4/10 * 100e18 = 40000000000000000000    (40e18 = 40%)
  bin +1: 2/10 * 100e18 = 20000000000000000000    (20e18 = 20%)
  bin +2: 1/10 * 100e18 = 10000000000000000000    (10e18 = 10%)

Apply composition rule:
  distributionX = [0, 0, 40000000000000000000, 20000000000000000000, 10000000000000000000]
  distributionY = [10000000000000000000, 20000000000000000000, 40000000000000000000, 0, 0]

  sumX = 70000000000000000000 -> fix last: distributionX[4] += 30000000000000000000
  sumY = 70000000000000000000 -> fix last non-zero (index 2): distributionY[2] += 30000000000000000000

  Wait -- that changes the concentration. Instead, distribute the remainder proportionally
  or add it to the last non-zero element.
```

**NOTE:** After applying the composition rule, the sums of distributionX and distributionY
will NOT equal the original total weight because some elements are zeroed out. Each array
independently sums to 100e18 (1e20) from its own non-zero elements.

**Better approach -- calculate distribution AFTER composition filtering:**

```
# Count bins that receive token X
xBins = bins where deltaId >= 0  (active + above)
# Count bins that receive token Y
yBins = bins where deltaId <= 0  (below + active)

# Assign weights within each group independently
For distributionX: only assign weights to xBins, normalize to 100e18 (1e20)
For distributionY: only assign weights to yBins, normalize to 100e18 (1e20)
```

**Tradeoffs:**
- Pros: Higher fee capture when price stays near active bin
- Cons: More impermanent loss if price moves away, needs frequent rebalancing
- Best for: Active management, high-volume pairs, range-bound markets

### Strategy: Wide Range

Uses many bins (50-200+) with equal or near-equal distribution.

**How it works:**
1. Choose a large number of bins (e.g., 101 bins = +/-50 from active)
2. Distribute equally across all bins
3. Accept lower fee concentration in exchange for less rebalancing

**With binStep 10 (0.10% per bin), 101 bins covers:**

```
Total range = 100 bins * 0.10% = 10% price movement
Price at edge = activePrice * (1.001)^50 = activePrice * 1.0512
```

So 101 bins covers roughly +/-5% from the current price.

**Tradeoffs:**
- Pros: Rarely needs rebalancing, lower gas costs over time, less active management
- Cons: Capital very spread out, low fee capture per unit of liquidity
- Best for: Long-term positions, low-attention management, volatile pairs

### Strategy: User-Defined (from Monadly UI)

The Monadly UI allows users to specify their range as percentages of the current price.

**Parameters from UI:**
- `minPercent`: e.g., -50 (50% below current price)
- `maxPercent`: e.g., +50 (50% above current price)
- `numBins`: e.g., 69 (how many bins to spread across)

#### Converting Percentage Range to Bin IDs

**Step 1: Calculate target prices**

```
currentPrice = binIdToPrice(activeId)
minPrice = currentPrice * (1 + minPercent/100)
maxPrice = currentPrice * (1 + maxPercent/100)
```

Example: current price = $52, minPercent = -50, maxPercent = +50

```
minPrice = 52 * (1 + (-50)/100) = 52 * 0.5 = $26
maxPrice = 52 * (1 + 50/100) = 52 * 1.5 = $78
```

**Step 2: Convert prices to bin IDs**

```
minBinId = priceToBinId(minPrice)
maxBinId = priceToBinId(maxPrice)
```

Using the reverse formula from the Bin Math Fundamentals section above.

**Step 3: Distribute numBins within the range**

If the user specifies 69 bins but the price range covers 693 possible bins, you need to
select 69 bins spaced evenly across the range:

```
totalPossibleBins = maxBinId - minBinId + 1

if numBins >= totalPossibleBins:
    # Use every bin in the range
    bins = [minBinId, minBinId+1, ..., maxBinId]
else:
    # Space bins evenly
    step = totalPossibleBins / numBins
    bins = [round(minBinId + i * step) for i in range(numBins)]
    # Ensure active bin is included
    if activeId not in bins:
        # Find the bin closest to activeId and replace it
        closestIdx = argmin(abs(bins[i] - activeId))
        bins[closestIdx] = activeId
    # Sort bins
    bins.sort()
```

**Step 4: Build delta IDs and distributions**

```
deltaIds = [bin - activeId for bin in bins]
# Then apply the standard composition rule and distribution algorithm
```

#### Alternative: Simple Centered Approach

If the user just specifies `numBins` without percentages, center them on the active bin:

```
halfRange = (numBins - 1) / 2
bins = [activeId - halfRange, ..., activeId, ..., activeId + halfRange]
deltaIds = [-halfRange, ..., 0, ..., +halfRange]
```

This is what the lb-rebalancer uses (with `numBins = 3`).

### When to Use Each Strategy

| Strategy | Fee Capture | IL Risk | Rebalance Freq | Gas Cost | Best For |
|----------|------------|---------|----------------|----------|----------|
| Concentrated (3-5 bins) | Highest | Highest | Very frequent | High over time | Active traders, MEV-aware bots |
| Uniform (11-31 bins) | Medium | Medium | Moderate | Medium | Balanced approach, semi-active |
| Wide (51-101 bins) | Low | Low | Rare | Low over time | Set-and-forget, volatile pairs |
| User-defined | Varies | Varies | Depends on range | Depends | Customized to user's thesis |

#### Decision Framework

1. **How often can you monitor?**
   - Every few minutes: Concentrated is fine
   - Every few hours: Uniform or wider
   - Once a day or less: Wide range

2. **How volatile is the pair?**
   - Stablecoin pairs: Concentrated works great (low IL)
   - Major pairs (MON/USDC): Uniform is a good default
   - Volatile/new tokens: Wide range to avoid constant rebalancing

3. **What is your gas budget?**
   - Rebalancing costs gas. If you rebalance 10x per day with concentrated,
     the gas may exceed the extra fees earned vs a wider range.
   - Rule of thumb: if gas cost per rebalance > 0.1% of position value,
     consider widening the range.

4. **What is the pool's bin step?**
   - Smaller bin step (1-5): Each bin covers less price movement, need more bins
   - Larger bin step (20-100): Each bin covers more, fewer bins needed
   - bin step 10 (0.10%): 100 bins = ~10% price range

### Computing Deploy Amounts

After choosing a strategy, you need to decide how much of each token to deposit.

**Ask the user how much to deploy.** There is no default cap -- the user decides their risk.
Always keep 10 MON as a gas reserve.

**Steps:**

1. Read wallet balances (native MON + token Y)
2. Read current price from active bin
3. Calculate total value in USD: `monBalance * price + tokenYBalance`
4. Ask user how much to deploy (show total available)
5. Split evenly by value: `deployMon = (deployValue / 2) / price`, `deployTokenY = deployValue / 2`

**Why split evenly by value?** In a symmetric distribution around the active bin, you need
roughly equal USD value of each token. The active bin takes both tokens (minimizing composition
fees), bins below take token Y, bins above take MON. For a centered range, the demands are
approximately balanced.

**Advanced: Match the active bin's composition.** For even lower composition fees, read the
active bin's reserves and split your active bin deposit to match:

```bash
RESERVES=$(cast call $POOL_ADDRESS "getBin(uint24)(uint128,uint128)" $ACTIVE_ID --rpc-url $MONAD_RPC_URL)
# Parse reserveX and reserveY, calculate the ratio, and split your active bin
# deposit accordingly. Other bins still follow the composition rule (X above, Y below).
```

For most cases, a 50/50 value split is close enough. The router refunds any excess tokens.

### Amount Calculation in Token Units

Remember to convert human-readable amounts to the token's smallest unit:

```
# MON: 18 decimals
# 1 MON = 1000000000000000000 wei
# To send 5.5 MON: 5500000000000000000

# USDC: 6 decimals
# 1 USDC = 1000000
# To send 100 USDC: 100000000
```

When using `cast`, you can use `cast --to-wei` for convenience:

```bash
# Convert 5.5 MON to wei
AMOUNT_X=$(cast --to-wei 5.5 ether)
# Result: 5500000000000000000

# Convert 100 USDC to smallest unit (6 decimals)
AMOUNT_Y=$(cast --to-wei 100 mwei)
# Result: 100000000
# NOTE: "mwei" is 6 decimals, which matches USDC
```

Alternatively, use `cast --to-unit`:

```bash
# From human-readable to smallest unit
cast --to-wei 5.5 ether     # 18 decimals -> 5500000000000000000
cast --to-wei 100 mwei      # 6 decimals  -> 100000000

# From smallest unit to human-readable
cast --from-wei 5500000000000000000 ether   # -> 5.5
cast --from-wei 100000000 mwei              # -> 100
```

## Environment Variables

Required (inherited from monadly-core):
```
MONAD_RPC_URL         -- Monad RPC endpoint
MONAD_PRIVATE_KEY     -- Wallet private key (NEVER display)
MONAD_WALLET_ADDRESS  -- Wallet public address
```

## Reading Pool State

### 1. Get the active bin ID (current price)

```bash
ACTIVE_ID=$(cast call $POOL_ADDRESS "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
echo "Active bin: $ACTIVE_ID"
```

### 2. Convert bin ID to human-readable price

Use the bin math formula (see Bin Math & Distribution Strategies section above for full derivation):

```
price = (1 + binStep/10000)^(binId - 8388608) * 10^(decimalsX - decimalsY)
```

For MON/USDC (decimalsX=18, decimalsY=6, binStep=10):
```
price = (1.001)^(binId - 8388608) * 10^12
```

### 3. Get reserves in a specific bin

```bash
cast call $POOL_ADDRESS "getBin(uint24)(uint128,uint128)" $BIN_ID --rpc-url $MONAD_RPC_URL
```

Returns `(reserveX, reserveY)` -- the amount of token X and token Y in that bin.

### 4. Check your LP token balance in a bin

```bash
cast call $POOL_ADDRESS "balanceOf(address,uint256)(uint256)" $MONAD_WALLET_ADDRESS $BIN_ID --rpc-url $MONAD_RPC_URL
```

### 5. Get total LP supply for a bin (to calculate your share)

```bash
cast call $POOL_ADDRESS "totalSupply(uint256)(uint256)" $BIN_ID --rpc-url $MONAD_RPC_URL
```

Your share of reserves = `(yourLpBalance / totalSupply) * binReserves`

## Adding Liquidity -- Full Workflow

**PREREQUISITE:** Run all monadly-core pre-flight checks first. No exceptions.

### Step 1: Verify deployable capital

monadly-core pre-flight check #6 already verified you have tokens. Now calculate exact
amounts for this specific pool, respecting the gas reserve:

```bash
# Deployable MON = total MON minus 0.05 gas reserve
MON_BALANCE=$(cast balance $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL --ether)
# DEPLOYABLE_MON = MON_BALANCE - 0.05

# Deployable token Y (e.g., USDC)
TOKEN_Y_RAW=$(cast call $TOKEN_Y_ADDRESS "balanceOf(address)(uint256)" $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL)
# Convert to human-readable: cast to-unit $TOKEN_Y_RAW <decimals>
```

**Before continuing to Step 2, tell the user what you have and ask how much to deploy:**

"Available: [X] MON and [Y] USDC (keeping 10 MON gas reserve).
How much would you like to deploy? (e.g., '100%', '50%', or specific amounts)"

**If monadly-core flagged a token imbalance, one of three paths applies:**

1. **User chose "swap to balance"** → monadly-core already performed the swap. Both tokens
   are now available. Proceed normally with balanced deployment.

2. **User chose "one-sided deployment"** → deploy with only the available token:
   - MON only → two sub-options:
     a. **Cost-efficient (recommended):** Use bins ABOVE active only (deltaIds > 0). No composition
        fees, but you earn zero trading fees until price rises into your bins.
     b. **Include active bin:** Use deltaIds >= 0. The active bin deposit triggers a composition
        fee (see Overview) but you earn fees immediately on that bin.
   - Token Y only → same logic but BELOW active:
     a. **Cost-efficient:** deltaIds < 0 only. No composition fees.
     b. **Include active bin:** deltaIds <= 0. Composition fee on active bin.
   - In Step 5, set the missing token's distribution array to all zeros for bins on the
     wrong side. E.g., MON only above active: `distributionY = [0, 0, 0, ...]`
   - Tell the user: "One-sided deposit available. Cost-efficient option places liquidity
     only in [above/below]-active bins (no composition fees, but fees earned only when
     price moves into your range). Or include the active bin for immediate fee earning
     but with a small composition fee. Which do you prefer?"

3. **User chose "wait and fund manually"** → STOP here. Do not proceed.

### Step 2: Read active bin and confirm price with user

Read the active bin FRESH -- this must be done immediately before deployment, not minutes
earlier during planning. The price can move.

```bash
ACTIVE_ID=$(cast call $POOL_ADDRESS "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
```

Convert to price (see Bin Math & Distribution Strategies section above for full formula):
```
price = (1 + binStep/10000)^(ACTIVE_ID - 8388608) * 10^(decimalsX - decimalsY)
```

**Price drift check -- compare against user's expected price:**

If the user specified a target price (from the Monadly UI "Current Price" field, or from
their message like "deploy at $52"), calculate how far the live price has moved:

```
priceDrift = abs(livePrice - userExpectedPrice) / userExpectedPrice * 100
```

**If priceDrift ≤ slippage tolerance (default 1%):**
Show confirmation normally:
"Current MON price: [X] USDC (active bin: [ACTIVE_ID]). This is within your 1% slippage
tolerance of [EXPECTED]. Deploying [A] MON + [B] USDC across [N] bins. Proceed?"

**If priceDrift > slippage tolerance:**
WARN and ask explicitly:
"Price has moved since you requested this deployment.

  Your expected price:  [EXPECTED] USDC/MON
  Current live price:   [LIVE] USDC/MON
  Drift:                [X]% ([DIRECTION: up/down])
  Your slippage setting: [S]%

This exceeds your slippage tolerance. Options:
1. Proceed at the new price ([LIVE] USDC/MON)
2. Wait and try again later

Which do you prefer?"

**If user didn't specify a price** (no reference point): show the live price and ask for
confirmation as normal. No drift to compare against.

**Wait for user to say yes.** Never deploy without this confirmation.

### Step 3: Approve token Y FIRST (before anything else)

Approval must happen BEFORE you attempt to simulate or send the addLiquidity call.
Without approval, any simulation of addLiquidity will revert with empty data -- because
the router can't pull your tokens.

```bash
# Check current allowance
ALLOWANCE=$(cast call $TOKEN_Y_ADDRESS "allowance(address,address)(uint256)" \
  $MONAD_WALLET_ADDRESS $LB_ROUTER --rpc-url $MONAD_RPC_URL)

# If allowance < deployment amount, approve 2x (NEVER unlimited)
# Example: deploying 50 USDC → approve 100 USDC (100 * 1e6 = 100000000)
if [ "$ALLOWANCE" -lt "$AMOUNT_Y" ]; then
  APPROVAL_AMOUNT=$((AMOUNT_Y * 2))
  cast send $TOKEN_Y_ADDRESS "approve(address,uint256)" $LB_ROUTER $APPROVAL_AMOUNT \
    --rpc-url $MONAD_RPC_URL \
    --private-key $MONAD_PRIVATE_KEY
  # Wait for approval tx to confirm before continuing
fi
```

**If approval tx reverts:** STOP. Check token address and router address are correct.

### Step 4: Calculate bin range

Determine which bins to deposit into. Example for 69 bins centered on active:

```
halfRange = (69 - 1) / 2 = 34
minBin = ACTIVE_ID - 34
maxBin = ACTIVE_ID + 34
```

### Step 5: Build distribution arrays

Construct three arrays: `deltaIds`, `distributionX`, `distributionY`.

See the Bin Math & Distribution Strategies section above for the full algorithm. Key rules:
- `deltaIds[i] = binId - activeId` (relative offset from active bin)
- Bins below active: distributionX = 0, distributionY = share
- Active bin: both distributionX and distributionY = share
- Bins above active: distributionX = share, distributionY = 0
- Each distribution array MUST sum to exactly **100e18** (= 1e20 = 100000000000000000000).
  NOT 1e18! The LFJ SDK defines 100% = 100e18.
- **Rounding fix:** After dividing 100e18 by numBins, add the remainder to the LAST
  non-zero element in each array. Example: 3 bins → sharePerBin = 33333333333333333333,
  last bin gets 33333333333333333334 (adds the 1 remainder).

### Step 6: Re-read active bin (freshness check)

```bash
FRESH_ACTIVE_ID=$(cast call $POOL_ADDRESS "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
```

If `FRESH_ACTIVE_ID != ACTIVE_ID` from Step 2, the price moved while you were calculating.
Recalculate from Step 4 with the new active ID. Do this max 2 times -- if price keeps moving,
tell user: "Price is moving too fast. Try again when the market is calmer."

### Step 7: Calculate slippage and deadline

```bash
# Slippage: 1% = 100 bps. Min amounts = 99% of deploy amounts.
SLIPPAGE_MULT=9900  # (10000 - 100)
AMOUNT_X_MIN=$((AMOUNT_X * SLIPPAGE_MULT / 10000))
AMOUNT_Y_MIN=$((AMOUNT_Y * SLIPPAGE_MULT / 10000))

# Deadline: current block timestamp + 300 seconds (5 minutes)
DEADLINE=$(($(cast block latest --field timestamp --rpc-url $MONAD_RPC_URL) + 300))

# ID slippage: how many bins the active ID can drift before tx reverts
# lb-rebalancer uses BIN_RANGE + 1. For wider ranges, use a proportional value.
ID_SLIPPAGE=$((BIN_RANGE + 1))
```

### Step 8: Simulate, estimate gas, then send addLiquidityNATIVE

**ALWAYS simulate first** with `cast call` before sending. This catches parameter errors without
spending gas:

```bash
# Simulate (dry run — does not send transaction)
cast call $LB_ROUTER \
  "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
  "($WMON,$TOKEN_Y,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
  --rpc-url $MONAD_RPC_URL \
  --from $MONAD_WALLET_ADDRESS \
  --value $AMOUNT_X
```

If the simulation reverts, DO NOT send. Fix the issue first.

**Then estimate gas** to know what you're spending:

```bash
GAS_ESTIMATE=$(cast estimate $LB_ROUTER \
  "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
  "($WMON,$TOKEN_Y,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
  --rpc-url $MONAD_RPC_URL \
  --from $MONAD_WALLET_ADDRESS \
  --value $AMOUNT_X)
echo "Estimated gas: $GAS_ESTIMATE"
```

**Now send the actual transaction. Do NOT set `--gas-limit` manually** -- let `cast` auto-estimate.
Setting a gas limit too low (e.g., 500,000) causes reverts on multi-bin deposits. The lb-rebalancer
also does not set a gas limit (viem auto-estimates).

```bash
cast send $LB_ROUTER \
  "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
  "($WMON,$TOKEN_Y,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
  --rpc-url $MONAD_RPC_URL \
  --private-key $MONAD_PRIVATE_KEY \
  --value $AMOUNT_X
```

**Parameter checklist (verify ALL before sending):**

| Parameter | Value | Verify |
|-----------|-------|--------|
| tokenX | WMON address from Contract Addresses section above | Must match `getWNATIVE()` |
| tokenY | Token Y address from Contract Addresses section above | Must match pool's token Y |
| binStep | Pool's bin step (e.g., 10) | Must match pool config |
| amountX | MON to deploy (in wei) | ≤ wallet balance - gas reserve |
| amountY | Token Y to deploy (in smallest unit) | ≤ wallet balance |
| amountXMin | amountX × 0.99 | Slippage protection |
| amountYMin | amountY × 0.99 | Slippage protection |
| activeIdDesired | FRESH active bin from Step 6 | Must be current |
| idSlippage | BIN_RANGE + 1 | Allows price drift |
| deltaIds | Relative offsets from active bin | Sum of bins = numBins |
| distributionX | MON distribution per bin | Must sum to exactly 100e18 (1e20) |
| distributionY | Token Y distribution per bin | Must sum to exactly 100e18 (1e20) |
| to | Your wallet address | Receives LP tokens |
| refundTo | Your wallet address | Gets refunded excess |
| deadline | block.timestamp + 300 | 5 min expiry |
| --value | MUST equal amountX | This sends the native MON |

**If `--value` is missing or wrong, the router gets 0 MON and the tx reverts.**

### Step 9: Verify the transaction

```bash
cast receipt $TX_HASH --rpc-url $MONAD_RPC_URL
```

Check `status` is `1` (success). If `0` (reverted), DO NOT proceed -- report failure.

After confirmation, verify LP tokens were received by checking `balanceOf` for each deposited bin.

## Removing Liquidity -- Full Workflow

### Step 1: Read LP balances per bin

For each bin in the position range, read the LP token balance:

```bash
cast call $POOL_ADDRESS "balanceOf(address,uint256)(uint256)" $MONAD_WALLET_ADDRESS $BIN_ID --rpc-url $MONAD_RPC_URL
```

Collect all bin IDs where balance > 0 and their corresponding LP amounts.

### Step 2: Calculate estimated reserves (for min amounts)

For each bin with LP tokens:

```bash
# Get bin reserves
cast call $POOL_ADDRESS "getBin(uint24)(uint128,uint128)" $BIN_ID --rpc-url $MONAD_RPC_URL

# Get total supply
cast call $POOL_ADDRESS "totalSupply(uint256)(uint256)" $BIN_ID --rpc-url $MONAD_RPC_URL
```

Your share: `(lpBalance / totalSupply) * reserves`

Sum across all bins to get total estimated amounts for min calculation.

### Step 3: Approve router to manage LP tokens

LP tokens are ERC-1155, so use `approveForAll` on the pool contract:

```bash
# Check if already approved
IS_APPROVED=$(cast call $POOL_ADDRESS "isApprovedForAll(address,address)(bool)" $MONAD_WALLET_ADDRESS $LB_ROUTER --rpc-url $MONAD_RPC_URL)

# If not approved
cast send $POOL_ADDRESS "approveForAll(address,bool)" $LB_ROUTER true \
  --rpc-url $MONAD_RPC_URL \
  --private-key $MONAD_PRIVATE_KEY
```

### Step 4: Call removeLiquidityNATIVE

**IMPORTANT (V2.2 Router):** The V2.2 `removeLiquidityNATIVE` takes the NON-native token
address and a `uint16` binStep. It does NOT take both tokenX and tokenY -- that's the old
V2.1 signature and will **silently revert with empty data** on V2.2.

```bash
cast send $LB_ROUTER \
  "removeLiquidityNATIVE(address,uint16,uint256,uint256,uint256[],uint256[],address,uint256)" \
  $TOKEN_Y $BIN_STEP $AMOUNT_Y_MIN $AMOUNT_X_MIN \
  "[$BIN_IDS]" "[$LP_AMOUNTS]" $TO $DEADLINE \
  --rpc-url $MONAD_RPC_URL \
  --private-key $MONAD_PRIVATE_KEY
```

**Parameters:**
- `$TOKEN_Y`: The **non-native** token (e.g., USDC). WMON is implicit.
- `$BIN_STEP`: Pool's bin step (e.g., 10)
- `$AMOUNT_TOKEN_MIN`, `$AMOUNT_NATIVE_MIN`: Minimum tokens to receive (with slippage)
- `$BIN_IDS`: Array of absolute bin IDs where you have LP tokens
- `$LP_AMOUNTS`: Array of LP token amounts to withdraw (one per bin)
- `$TO`: Address to receive tokens (your wallet)
- `$DEADLINE`: Block timestamp + 300

### Step 5: Verify and confirm

Wait for receipt, verify status = 1, confirm LP tokens are now 0 in those bins.

## Rebalancing -- Complete Cycle

A rebalance is: check range, remove old liquidity, recalculate new range, add new liquidity.

### When to rebalance

The active bin has moved outside your position range. Check:

```bash
ACTIVE_ID=$(cast call $POOL_ADDRESS "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
# Compare ACTIVE_ID against your stored minBin/maxBin
# If ACTIVE_ID < minBin or ACTIVE_ID > maxBin: rebalance needed
```

### Rebalance flow

1. **Run pre-flight checks** (monadly-core)
2. **Check cooldown** -- do not rebalance if last rebalance was < 60 seconds ago
3. **Remove all existing liquidity** (follow removal workflow above)
4. **Wait for tx confirmation** -- if removal fails, STOP immediately
5. **Read fresh active bin** -- price may have moved during removal
6. **Calculate new bin range** centered on fresh active bin
7. **Calculate deploy amounts** -- ask user how much to redeploy (default: all returned tokens)
8. **Build new distribution arrays** (see Bin Math & Distribution Strategies section above)
9. **Add liquidity** (follow addition workflow above)
10. **Update positions.json** with new range and `lastRebalance` timestamp
11. **Log transaction** to tx-log.json

**If ANY step fails, STOP. Do not attempt the next step. Report the failure.**

## Safety Rules (LFJ-Specific)

These supplement the monadly-core safety rules:

1. **ALWAYS verify the pool address** against the Contract Addresses section above, or discover it
   via LBFactory before interacting.

2. **ALWAYS check bin step** matches your expectations. A pool with bin step 1 vs 25 has
   vastly different price ranges per bin.

3. **NEVER send native MON without `--value`.** When calling `addLiquidityNATIVE`, the
   `--value` flag is what sends the MON. Forgetting it means the router gets 0 MON.

4. **ALWAYS verify distribution sums.** distributionX elements that are non-zero must sum
   to exactly 100e18 (= 1e20). Same for distributionY. Using 1e18 instead of 100e18 will
   revert with `LiquidityConfigurations__InvalidConfig`.

5. **ALWAYS check composition rule for non-active bins.** Bins below active = only token Y.
   Bins above active = only token X. Violating this reverts with `CompositionFactorFlawed`.
   The active bin can accept any ratio, but mismatched ratios incur composition fees.

6. **ALWAYS set `approveForAll` before removing liquidity.** LP tokens are ERC-1155.
   Standard ERC-20 `approve` does not work.

7. **Check for MEV.** Between removal and addition, the active bin can move. Always re-read
   the active bin after removal before building the new distribution.

8. **Be aware of composition fees.** When depositing into the active bin, match the bin's
   current composition ratio to minimize fees. A 50/50 value split (like lb-rebalancer uses)
   is a safe default. Single-sided deposits into the active bin work but cost more.

9. **NEVER set `--gas-limit` manually.** Let `cast` auto-estimate gas. Multi-bin deposits
   can use significantly more gas than expected (especially 50+ bins). A hardcoded limit
   that is too low causes the transaction to revert and wastes the gas fee.

## Command Mapping (from Monadly UI)

| Monadly Command | Action |
|-----------------|--------|
| `pool:analyze` | Read pool state: active bin, price, reserves, bin step |
| `pool:position` | Scan bins for LP tokens, calculate position value |
| `pool:rebalance` | Full rebalance cycle (remove + add) |
| `pool:set-range` | Save range settings, then add liquidity |
| Natural: "deploy on LFJ..." | Parse pool info, confirm, add liquidity |
| Natural: "rebalance LFJ..." | Parse, confirm, execute rebalance cycle |
| Natural: "check LFJ position" | Scan and report position status |

## Step-by-Step Examples

All examples use these environment variables:

```bash
MONAD_RPC_URL="https://rpc.monad.xyz"       # Or your local node: http://localhost:8545
MONAD_WALLET_ADDRESS="0xYourWalletAddress"
MONAD_PRIVATE_KEY="0xYourPrivateKey"         # NEVER display this in output
```

And these contract addresses (Monad mainnet):

```bash
LB_ROUTER="0x18556DA13313f3532c54711497A8FedAC273220E"
LB_FACTORY="0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c"
POOL="0x5E60BC3F7a7303BC4dfE4dc2220bdC90bc04fE22"  # MON/USDC binStep=10
WMON="0x3bd359c1119da7da1d913d1c4d2b7c461115433a"
USDC="0x754704bc059f8c67012fed69bc8a327a5aafb603"
BIN_STEP=10
```

---

### Example 1: Read Pool State

Goal: Get the active bin, current price, and reserves in the active bin.

#### Step 1: Get the active bin ID

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
echo "Active bin ID: $ACTIVE_ID"
```

#### Step 2: Calculate price from bin ID

The price formula is: `price = (1 + binStep/10000)^(binId - 8388608) * 10^(decimalsX - decimalsY)`

For MON/USDC (decimalsX=18, decimalsY=6, binStep=10):

```bash
# Using Python for the math (or bc, or any calculator)
PRICE=$(python3 -c "
bin_id = $ACTIVE_ID
base = 8388608
bin_step = $BIN_STEP
raw_price = (1 + bin_step / 10000) ** (bin_id - base)
adjusted_price = raw_price * (10 ** (18 - 6))
print(f'{adjusted_price:.6f}')
")
echo "Current price: $PRICE USDC/MON"
```

#### Step 3: Get reserves in the active bin

```bash
RESERVES=$(cast call $POOL "getBin(uint24)(uint128,uint128)" $ACTIVE_ID --rpc-url $MONAD_RPC_URL)
echo "Active bin reserves: $RESERVES"

# Parse the two return values
RESERVE_X=$(echo "$RESERVES" | head -1)
RESERVE_Y=$(echo "$RESERVES" | tail -1)

# Convert to human-readable
RESERVE_X_HUMAN=$(cast --from-wei $RESERVE_X ether)
RESERVE_Y_HUMAN=$(cast --from-wei $RESERVE_Y mwei)
echo "Reserve X (MON): $RESERVE_X_HUMAN"
echo "Reserve Y (USDC): $RESERVE_Y_HUMAN"
```

#### Step 4: Verify pool tokens

```bash
TOKEN_X=$(cast call $POOL "getTokenX()(address)" --rpc-url $MONAD_RPC_URL)
TOKEN_Y=$(cast call $POOL "getTokenY()(address)" --rpc-url $MONAD_RPC_URL)
echo "Token X: $TOKEN_X"
echo "Token Y: $TOKEN_Y"
```

---

### Example 2: Check Your Position

Goal: Find all bins where you have LP tokens and calculate your position value.

#### Step 1: Determine scan range

Scan bins around the active bin. Use a wider range to catch positions that may have drifted.

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
SCAN_RANGE=50  # Check 50 bins on each side of active

MIN_SCAN=$((ACTIVE_ID - SCAN_RANGE))
MAX_SCAN=$((ACTIVE_ID + SCAN_RANGE))
echo "Scanning bins $MIN_SCAN to $MAX_SCAN"
```

#### Step 2: Scan for LP tokens (batch method)

Build arrays for balanceOfBatch. Each element needs the wallet address repeated.

```bash
# Build arrays for batch query
ACCOUNTS=""
IDS=""
for BIN in $(seq $MIN_SCAN $MAX_SCAN); do
    if [ -n "$ACCOUNTS" ]; then
        ACCOUNTS="$ACCOUNTS,$MONAD_WALLET_ADDRESS"
        IDS="$IDS,$BIN"
    else
        ACCOUNTS="$MONAD_WALLET_ADDRESS"
        IDS="$BIN"
    fi
done

# Batch query
BALANCES=$(cast call $POOL \
    "balanceOfBatch(address[],uint256[])(uint256[])" \
    "[$ACCOUNTS]" "[$IDS]" \
    --rpc-url $MONAD_RPC_URL)
echo "LP balances: $BALANCES"
```

#### Step 3: For each bin with LP tokens, calculate your share

For each bin where LP balance > 0:

```bash
# For a single bin (repeat for each bin with balance > 0)
BIN_ID=8364948  # Example bin
LP_BALANCE=$(cast call $POOL "balanceOf(address,uint256)(uint256)" $MONAD_WALLET_ADDRESS $BIN_ID --rpc-url $MONAD_RPC_URL)

if [ "$LP_BALANCE" != "0" ]; then
    # Get total supply for this bin
    TOTAL_SUPPLY=$(cast call $POOL "totalSupply(uint256)(uint256)" $BIN_ID --rpc-url $MONAD_RPC_URL)

    # Get bin reserves
    RESERVES=$(cast call $POOL "getBin(uint24)(uint128,uint128)" $BIN_ID --rpc-url $MONAD_RPC_URL)
    RESERVE_X=$(echo "$RESERVES" | head -1)
    RESERVE_Y=$(echo "$RESERVES" | tail -1)

    # Calculate your share: (lpBalance / totalSupply) * reserves
    # Using Python for big number math
    python3 -c "
lp = $LP_BALANCE
total = $TOTAL_SUPPLY
rx = $RESERVE_X
ry = $RESERVE_Y
if total > 0:
    my_x = rx * lp // total
    my_y = ry * lp // total
    print(f'Bin {$BIN_ID}: {my_x / 1e18:.6f} MON + {my_y / 1e6:.2f} USDC')
else:
    print(f'Bin {$BIN_ID}: empty (totalSupply = 0)')
"
fi
```

#### Step 4: Sum across all bins for total position value

```bash
# After collecting all per-bin amounts, sum them and multiply MON by current price
# This is typically done in a script loop; the pattern per bin is shown above
```

---

### Example 3: Add Liquidity (Full Workflow)

Goal: Add liquidity to 69 bins centered on the active bin, deploying 50% of wallet value.

#### Step 1: Pre-flight checks (monadly-core)

```bash
# Verify chain
CHAIN_ID=$(cast chain-id --rpc-url $MONAD_RPC_URL)
if [ "$CHAIN_ID" != "143" ]; then
    echo "ERROR: Wrong chain. Expected 143, got $CHAIN_ID"
    exit 1
fi

# Verify wallet has gas
MON_BALANCE=$(cast balance $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL --ether)
echo "MON balance: $MON_BALANCE"

# Verify wallet matches key
DERIVED_ADDRESS=$(cast wallet address --private-key $MONAD_PRIVATE_KEY)
if [ "$DERIVED_ADDRESS" != "$MONAD_WALLET_ADDRESS" ]; then
    echo "ERROR: Wallet address does not match private key"
    exit 1
fi
```

#### Step 2: Check balances

```bash
# Native MON (in wei)
MON_BALANCE_WEI=$(cast balance $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL)
MON_BALANCE_HUMAN=$(cast --from-wei $MON_BALANCE_WEI ether)
echo "MON: $MON_BALANCE_HUMAN"

# USDC balance
USDC_BALANCE=$(cast call $USDC "balanceOf(address)(uint256)" $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL)
USDC_BALANCE_HUMAN=$(cast --from-wei $USDC_BALANCE mwei)
echo "USDC: $USDC_BALANCE_HUMAN"
```

#### Step 3: Get active bin and calculate range

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
NUM_BINS=69
HALF_RANGE=$(( (NUM_BINS - 1) / 2 ))  # 34
MIN_BIN=$((ACTIVE_ID - HALF_RANGE))
MAX_BIN=$((ACTIVE_ID + HALF_RANGE))
echo "Active bin: $ACTIVE_ID"
echo "Range: $MIN_BIN to $MAX_BIN ($NUM_BINS bins)"
```

#### Step 4: Calculate deploy amounts

```bash
# Calculate current price
PRICE=$(python3 -c "
bin_id = $ACTIVE_ID
raw = (1.001) ** (bin_id - 8388608)
price = raw * (10 ** 12)
print(f'{price:.6f}')
")

# Calculate total value and deploy amounts
python3 -c "
mon_wei = $MON_BALANCE_WEI
usdc_raw = $USDC_BALANCE
price = float('$PRICE')

# Total value in USD
mon_usd = (mon_wei / 1e18) * price
usdc_usd = usdc_raw / 1e6
total_usd = mon_usd + usdc_usd

# Deploy 50% of total value
deploy_usd = total_usd * 0.5
deploy_mon_usd = deploy_usd / 2
deploy_usdc_usd = deploy_usd / 2

# Convert back to token amounts
deploy_mon = deploy_mon_usd / price
deploy_usdc = deploy_usdc_usd

# Convert to smallest units
amount_x = int(deploy_mon * 1e18)
amount_y = int(deploy_usdc * 1e6)

# Slippage (1%)
amount_x_min = amount_x * 9900 // 10000
amount_y_min = amount_y * 9900 // 10000

print(f'AMOUNT_X={amount_x}')
print(f'AMOUNT_Y={amount_y}')
print(f'AMOUNT_X_MIN={amount_x_min}')
print(f'AMOUNT_Y_MIN={amount_y_min}')
print(f'Deploy: {deploy_mon:.4f} MON (\${deploy_mon_usd:.2f}) + {deploy_usdc:.2f} USDC')
print(f'Total position value: \${deploy_usd:.2f} of \${total_usd:.2f} total')
"
```

#### Step 5: Build distribution arrays

```bash
# Generate the three arrays using Python
# CRITICAL: LFJ uses 100e18 (1e20) as 100%, NOT 1e18!
ARRAYS=$(python3 -c "
active_id = $ACTIVE_ID
num_bins = $NUM_BINS
half = (num_bins - 1) // 2

TOTAL = 100 * 10**18  # 100e18 = 1e20 (LFJ's 100%)

delta_ids = []
dist_x = []
dist_y = []
share = TOTAL // num_bins  # Equal per bin

for i in range(num_bins):
    delta = i - half  # Offset from active
    delta_ids.append(delta)

    if delta < 0:
        # Below active: only Y
        dist_x.append(0)
        dist_y.append(share)
    elif delta == 0:
        # Active bin: both
        dist_x.append(share)
        dist_y.append(share)
    else:
        # Above active: only X
        dist_x.append(share)
        dist_y.append(0)

# Fix rounding for distributionX (must sum to exactly 100e18)
sum_x = sum(dist_x)
if sum_x > 0 and sum_x < TOTAL:
    for j in range(len(dist_x) - 1, -1, -1):
        if dist_x[j] > 0:
            dist_x[j] += TOTAL - sum_x
            break

# Fix rounding for distributionY (must sum to exactly 100e18)
sum_y = sum(dist_y)
if sum_y > 0 and sum_y < TOTAL:
    for j in range(len(dist_y) - 1, -1, -1):
        if dist_y[j] > 0:
            dist_y[j] += TOTAL - sum_y
            break

# Format as comma-separated for cast
print('DELTA_IDS=' + ','.join(str(d) for d in delta_ids))
print('DIST_X=' + ','.join(str(d) for d in dist_x))
print('DIST_Y=' + ','.join(str(d) for d in dist_y))

# Verification (both must equal 100e18 = 100000000000000000000)
final_x = sum(dist_x)
final_y = sum(dist_y)
print(f'# Verify sumX={final_x} == 100e18: {final_x == TOTAL}')
print(f'# Verify sumY={final_y} == 100e18: {final_y == TOTAL}')
")
echo "$ARRAYS"
eval "$ARRAYS"
```

#### Step 6: Check and set USDC approval

```bash
ALLOWANCE=$(cast call $USDC "allowance(address,address)(uint256)" \
    $MONAD_WALLET_ADDRESS $LB_ROUTER --rpc-url $MONAD_RPC_URL)

if [ "$ALLOWANCE" -lt "$AMOUNT_Y" ]; then
    # Approve 2x the needed amount (NEVER unlimited)
    APPROVAL_AMOUNT=$((AMOUNT_Y * 2))
    echo "Approving $APPROVAL_AMOUNT USDC for router..."

    APPROVE_TX=$(cast send $USDC "approve(address,uint256)" \
        $LB_ROUTER $APPROVAL_AMOUNT \
        --rpc-url $MONAD_RPC_URL \
        --private-key $MONAD_PRIVATE_KEY \
        --json | jq -r '.transactionHash')

    echo "Approval TX: $APPROVE_TX"

    # Wait for confirmation
    cast receipt $APPROVE_TX --rpc-url $MONAD_RPC_URL --json | jq '.status'
fi
```

#### Step 7: Get deadline

```bash
CURRENT_TIMESTAMP=$(cast block latest --field timestamp --rpc-url $MONAD_RPC_URL)
DEADLINE=$((CURRENT_TIMESTAMP + 300))  # 5 minutes
echo "Deadline: $DEADLINE"
```

#### Step 8: Simulate, estimate gas, then send addLiquidityNATIVE

```bash
ID_SLIPPAGE=$((HALF_RANGE + 1))  # 35

# STEP 8a: Simulate first (catch errors without spending gas)
echo "Simulating addLiquidityNATIVE..."
cast call $LB_ROUTER \
    "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
    "($WMON,$USDC,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
    --rpc-url $MONAD_RPC_URL \
    --from $MONAD_WALLET_ADDRESS \
    --value $AMOUNT_X
# If this reverts, STOP and fix the issue. Do NOT proceed to send.

# STEP 8b: Estimate gas
GAS_ESTIMATE=$(cast estimate $LB_ROUTER \
    "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
    "($WMON,$USDC,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
    --rpc-url $MONAD_RPC_URL \
    --from $MONAD_WALLET_ADDRESS \
    --value $AMOUNT_X)
echo "Estimated gas: $GAS_ESTIMATE"

# STEP 8c: Send (do NOT set --gas-limit, let cast auto-estimate)
TX_HASH=$(cast send $LB_ROUTER \
    "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
    "($WMON,$USDC,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
    --rpc-url $MONAD_RPC_URL \
    --private-key $MONAD_PRIVATE_KEY \
    --value $AMOUNT_X \
    --json | jq -r '.transactionHash')

echo "Add liquidity TX: $TX_HASH"
```

#### Step 9: Wait for receipt and verify

```bash
RECEIPT=$(cast receipt $TX_HASH --rpc-url $MONAD_RPC_URL --json)
STATUS=$(echo "$RECEIPT" | jq -r '.status')

if [ "$STATUS" = "0x1" ] || [ "$STATUS" = "1" ]; then
    echo "SUCCESS: Liquidity added"

    # Verify LP tokens exist in the active bin
    LP_CHECK=$(cast call $POOL "balanceOf(address,uint256)(uint256)" \
        $MONAD_WALLET_ADDRESS $ACTIVE_ID --rpc-url $MONAD_RPC_URL)
    echo "LP balance in active bin: $LP_CHECK"
else
    echo "FAILED: Transaction reverted. DO NOT proceed."
    echo "Receipt: $RECEIPT"
    exit 1
fi
```

---

### Example 4: Remove Liquidity (Full Workflow)

Goal: Remove all liquidity from your current position.

#### Step 1: Find bins with LP tokens

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
SCAN_RANGE=50
MIN_SCAN=$((ACTIVE_ID - SCAN_RANGE))
MAX_SCAN=$((ACTIVE_ID + SCAN_RANGE))

# Scan each bin for LP tokens and collect non-zero bins
BIN_IDS=""
LP_AMOUNTS=""
TOTAL_X=0
TOTAL_Y=0

for BIN in $(seq $MIN_SCAN $MAX_SCAN); do
    LP=$(cast call $POOL "balanceOf(address,uint256)(uint256)" \
        $MONAD_WALLET_ADDRESS $BIN --rpc-url $MONAD_RPC_URL 2>/dev/null)

    if [ -n "$LP" ] && [ "$LP" != "0" ]; then
        echo "Bin $BIN: LP=$LP"

        # Add to arrays
        if [ -n "$BIN_IDS" ]; then
            BIN_IDS="$BIN_IDS,$BIN"
            LP_AMOUNTS="$LP_AMOUNTS,$LP"
        else
            BIN_IDS="$BIN"
            LP_AMOUNTS="$LP"
        fi

        # Calculate share of reserves for min amounts
        TOTAL_SUPPLY=$(cast call $POOL "totalSupply(uint256)(uint256)" $BIN --rpc-url $MONAD_RPC_URL)
        RESERVES=$(cast call $POOL "getBin(uint24)(uint128,uint128)" $BIN --rpc-url $MONAD_RPC_URL)
        RX=$(echo "$RESERVES" | head -1)
        RY=$(echo "$RESERVES" | tail -1)

        # Accumulate estimated reserves (for min amount calculation)
        # Using Python for big number arithmetic
        eval $(python3 -c "
lp = $LP
total = $TOTAL_SUPPLY
rx = $RX
ry = $RY
prev_x = $TOTAL_X
prev_y = $TOTAL_Y
if total > 0:
    my_x = rx * lp // total
    my_y = ry * lp // total
    print(f'TOTAL_X={prev_x + my_x}')
    print(f'TOTAL_Y={prev_y + my_y}')
else:
    print(f'TOTAL_X={prev_x}')
    print(f'TOTAL_Y={prev_y}')
")
    fi
done

echo "Bins with liquidity: [$BIN_IDS]"
echo "LP amounts: [$LP_AMOUNTS]"
echo "Estimated reserves: $TOTAL_X MON (wei), $TOTAL_Y USDC (raw)"
```

#### Step 2: Calculate minimum amounts with slippage

```bash
# 1% slippage
AMOUNT_X_MIN=$((TOTAL_X * 9900 / 10000))
AMOUNT_Y_MIN=$((TOTAL_Y * 9900 / 10000))
echo "Min MON: $AMOUNT_X_MIN"
echo "Min USDC: $AMOUNT_Y_MIN"
```

#### Step 3: Approve router for LP tokens (if not already)

```bash
IS_APPROVED=$(cast call $POOL "isApprovedForAll(address,address)(bool)" \
    $MONAD_WALLET_ADDRESS $LB_ROUTER --rpc-url $MONAD_RPC_URL)

if [ "$IS_APPROVED" = "false" ]; then
    echo "Approving router for LP tokens..."
    APPROVE_TX=$(cast send $POOL "approveForAll(address,bool)" $LB_ROUTER true \
        --rpc-url $MONAD_RPC_URL \
        --private-key $MONAD_PRIVATE_KEY \
        --json | jq -r '.transactionHash')

    cast receipt $APPROVE_TX --rpc-url $MONAD_RPC_URL --json | jq '.status'
    echo "Approval confirmed"
fi
```

#### Step 4: Get deadline and send removeLiquidityNATIVE

```bash
CURRENT_TIMESTAMP=$(cast block latest --field timestamp --rpc-url $MONAD_RPC_URL)
DEADLINE=$((CURRENT_TIMESTAMP + 300))

# V2.2: Only pass the non-native token (USDC), NOT both tokens
# The router knows WMON via getWNATIVE()
TX_HASH=$(cast send $LB_ROUTER \
    "removeLiquidityNATIVE(address,uint16,uint256,uint256,uint256[],uint256[],address,uint256)" \
    $USDC $BIN_STEP $AMOUNT_Y_MIN $AMOUNT_X_MIN \
    "[$BIN_IDS]" "[$LP_AMOUNTS]" $MONAD_WALLET_ADDRESS $DEADLINE \
    --rpc-url $MONAD_RPC_URL \
    --private-key $MONAD_PRIVATE_KEY \
    --json | jq -r '.transactionHash')

echo "Remove liquidity TX: $TX_HASH"
```

#### Step 5: Wait for receipt and verify

```bash
RECEIPT=$(cast receipt $TX_HASH --rpc-url $MONAD_RPC_URL --json)
STATUS=$(echo "$RECEIPT" | jq -r '.status')

if [ "$STATUS" = "0x1" ] || [ "$STATUS" = "1" ]; then
    echo "SUCCESS: Liquidity removed"

    # Verify LP tokens are now 0
    LP_CHECK=$(cast call $POOL "balanceOf(address,uint256)(uint256)" \
        $MONAD_WALLET_ADDRESS $ACTIVE_ID --rpc-url $MONAD_RPC_URL)
    echo "LP balance in active bin (should be 0): $LP_CHECK"

    # Check final wallet balances
    NEW_MON=$(cast balance $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL --ether)
    NEW_USDC=$(cast call $USDC "balanceOf(address)(uint256)" $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL)
    echo "Final MON: $NEW_MON"
    echo "Final USDC: $(cast --from-wei $NEW_USDC mwei)"
else
    echo "FAILED: Transaction reverted. Position NOT removed."
    echo "Receipt: $RECEIPT"
    exit 1
fi
```

---

### Example 5: Full Rebalance Cycle

Goal: Remove existing liquidity, recalculate position around the new active bin, and add liquidity again.

#### Pre-conditions

- Pre-flight checks (monadly-core) must pass
- Cooldown must have elapsed (60 seconds since last rebalance)
- Active bin must be outside your current range

#### Step 1: Check if rebalance is needed

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)

# Load your stored position range (from monadly-positions.json or environment)
POSITION_MIN_BIN=8364914  # Example: stored min bin
POSITION_MAX_BIN=8364982  # Example: stored max bin

if [ "$ACTIVE_ID" -ge "$POSITION_MIN_BIN" ] && [ "$ACTIVE_ID" -le "$POSITION_MAX_BIN" ]; then
    echo "Active bin $ACTIVE_ID is within range [$POSITION_MIN_BIN, $POSITION_MAX_BIN]. No rebalance needed."
    exit 0
else
    echo "Active bin $ACTIVE_ID is OUTSIDE range [$POSITION_MIN_BIN, $POSITION_MAX_BIN]. Rebalancing..."
fi
```

#### Step 2: Remove all existing liquidity

Follow the complete removal workflow from Example 4 above. Store the tx hash and verify success.

```bash
# [Execute Example 4: Steps 1-5]
# After successful removal, continue to Step 3
# If removal FAILS: STOP immediately. Do NOT attempt to add new liquidity.
```

#### Step 3: Re-read the active bin (it may have moved during removal)

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)
echo "Fresh active bin after removal: $ACTIVE_ID"
```

#### Step 4: Calculate new position

```bash
# Read updated wallet balances (now includes returned liquidity)
MON_BALANCE_WEI=$(cast balance $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL)
USDC_BALANCE=$(cast call $USDC "balanceOf(address)(uint256)" $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL)

# Calculate deploy amounts (50% of total)
# [Use the calculation from Example 3: Step 4]

# Build new distribution arrays centered on fresh active bin
# [Use the distribution generation from Example 3: Step 5]
```

#### Step 5: Add new liquidity

Follow the complete addition workflow from Example 3, Steps 6-9.

```bash
# [Execute Example 3: Steps 6-9]
# After successful addition, continue to Step 6
```

#### Step 6: Update state

After both transactions confirm:

```bash
echo "Rebalance complete."
echo "Old range: $POSITION_MIN_BIN - $POSITION_MAX_BIN"
echo "New range: $MIN_BIN - $MAX_BIN"
echo "New active bin: $ACTIVE_ID"
# Update monadly-positions.json with new range and lastRebalance timestamp
```

---

### Example 6: Price Monitoring (Check If Active Bin Is In Range)

Goal: Periodically check if the active bin is still within your position range.

#### Simple one-shot check

```bash
ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL)

# Your position range (loaded from monadly-positions.json)
MY_MIN=8364914
MY_MAX=8364982

# Calculate price
PRICE=$(python3 -c "
bin_id = $ACTIVE_ID
raw = (1.001) ** (bin_id - 8388608)
price = raw * (10 ** 12)
print(f'{price:.4f}')
")

MIN_PRICE=$(python3 -c "
raw = (1.001) ** ($MY_MIN - 8388608)
print(f'{raw * 1e12:.4f}')
")

MAX_PRICE=$(python3 -c "
raw = (1.001) ** ($MY_MAX - 8388608)
print(f'{raw * 1e12:.4f}')
")

if [ "$ACTIVE_ID" -ge "$MY_MIN" ] && [ "$ACTIVE_ID" -le "$MY_MAX" ]; then
    # Calculate how far from center (as percentage of range)
    CENTER=$(( (MY_MIN + MY_MAX) / 2 ))
    RANGE_SIZE=$(( MY_MAX - MY_MIN ))
    DISTANCE=$(( ACTIVE_ID - CENTER ))
    if [ "$RANGE_SIZE" -gt 0 ]; then
        PCT=$(python3 -c "print(f'{abs($DISTANCE) / ($RANGE_SIZE / 2) * 100:.1f}')")
    else
        PCT="0.0"
    fi

    echo "IN RANGE | Bin: $ACTIVE_ID | Price: \$$PRICE | Range: \$$MIN_PRICE - \$$MAX_PRICE | Distance from center: ${PCT}%"
else
    echo "OUT OF RANGE | Bin: $ACTIVE_ID | Price: \$$PRICE | Range: \$$MIN_PRICE - \$$MAX_PRICE | REBALANCE NEEDED"
fi
```

#### Continuous monitoring loop

```bash
INTERVAL=60  # Check every 60 seconds

while true; do
    ACTIVE_ID=$(cast call $POOL "getActiveId()(uint24)" --rpc-url $MONAD_RPC_URL 2>/dev/null)

    if [ -z "$ACTIVE_ID" ]; then
        echo "$(date '+%H:%M:%S') | RPC error, retrying in ${INTERVAL}s..."
        sleep $INTERVAL
        continue
    fi

    PRICE=$(python3 -c "
raw = (1.001) ** ($ACTIVE_ID - 8388608)
print(f'{raw * 1e12:.4f}')
")

    if [ "$ACTIVE_ID" -ge "$MY_MIN" ] && [ "$ACTIVE_ID" -le "$MY_MAX" ]; then
        echo "$(date '+%H:%M:%S') | IN RANGE  | Bin: $ACTIVE_ID | Price: \$$PRICE"
    else
        echo "$(date '+%H:%M:%S') | OUT OF RANGE | Bin: $ACTIVE_ID | Price: \$$PRICE | ACTION NEEDED"
        # Trigger rebalance or send alert here
    fi

    sleep $INTERVAL
done
```

---

### Common Pitfalls and Debugging

#### Transaction reverts with no error

Most common causes (in order of likelihood):
1. **Gas limit too low.** NEVER set `--gas-limit` manually. Multi-bin deposits can use
   1M+ gas. Let `cast` auto-estimate.
2. **Insufficient approval.** USDC allowance < amountY. Approve BEFORE simulating.
3. **Distribution sums wrong.** Each non-zero distribution array must sum to exactly
   **100e18** (= 1e20 = 100000000000000000000). NOT 1e18! Using 1e18 reverts with
   `LiquidityConfigurations__InvalidConfig` (error code 0xeea4aafe).
4. **Composition rule violated.** Token X in a bin below active, or token Y above active.
   Note: the active bin accepts any ratio (but mismatched ratios incur composition fees).
5. **Missing `--value` flag.** Native MON is not sent without `--value`.
6. **Deadline expired.** Transaction sat in mempool too long.
7. **Active bin shifted.** Active bin moved beyond `idSlippage` between read and send.

#### The golden rule: ALWAYS simulate before sending

```bash
# Simulate with cast call (does not send, shows revert reason)
cast call $LB_ROUTER \
    "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
    "($WMON,$USDC,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
    --rpc-url $MONAD_RPC_URL \
    --from $MONAD_WALLET_ADDRESS \
    --value $AMOUNT_X
```

If simulation succeeds → safe to send. If it reverts → fix the issue first (saves gas).

#### Then estimate gas

```bash
cast estimate $LB_ROUTER \
    "addLiquidityNATIVE((address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256))" \
    "($WMON,$USDC,$BIN_STEP,$AMOUNT_X,$AMOUNT_Y,$AMOUNT_X_MIN,$AMOUNT_Y_MIN,$ACTIVE_ID,$ID_SLIPPAGE,[$DELTA_IDS],[$DIST_X],[$DIST_Y],$MONAD_WALLET_ADDRESS,$MONAD_WALLET_ADDRESS,$DEADLINE)" \
    --rpc-url $MONAD_RPC_URL \
    --from $MONAD_WALLET_ADDRESS \
    --value $AMOUNT_X
```

#### Understanding composition fee errors

If your deposit into the active bin seems to "cost more" than expected, check for composition
fees. Read the active bin's reserves and compare your deposit ratio:

```bash
# Current bin composition
RESERVES=$(cast call $POOL "getBin(uint24)(uint128,uint128)" $ACTIVE_ID --rpc-url $MONAD_RPC_URL)
echo "Bin reserves — X: $(echo "$RESERVES" | head -1), Y: $(echo "$RESERVES" | tail -1)"
# If you're depositing 100% X but the bin is 50/50, you'll pay a composition fee
```
