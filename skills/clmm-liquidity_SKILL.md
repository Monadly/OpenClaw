---
name: clmm-liquidity
description: |
  Manage concentrated liquidity (CLMM) positions on Uniswap V4, Uniswap V3, and PancakeSwap V3
  pools on Monad. Handles deploying new positions, reading position state, collecting fees,
  withdrawing liquidity, and rebalancing. Use when the user mentions Uniswap, PancakeSwap, CLMM,
  concentrated liquidity, ticks, tick ranges, fee tiers, or V3/V4 pools on Monad.
  ALWAYS run monadly-core pre-flight checks before any transaction.
user-invocable: true
source: https://github.com/Monadly/OpenClaw/blob/main/skills/clmm-liquidity_SKILL.md
metadata: {"openclaw": {"requires": {"bins": ["cast"]}, "primaryEnv": "MONAD_RPC_URL"}}
---

# CLMM Liquidity Skill -- Concentrated Liquidity on Monad

You manage concentrated liquidity positions on Uniswap V4, Uniswap V3, and PancakeSwap V3
pools on Monad (Chain ID: 143). You use Monad Foundry's `cast` CLI for all on-chain interactions.
You NEVER use viem, ethers.js, or any other JS library -- everything goes through `cast`.

## Overview: CLMM (Concentrated Liquidity Market Maker)

CLMM pools let LPs concentrate their capital within specific price ranges instead of spreading
it across the entire price curve. This dramatically increases capital efficiency -- you earn
fees only when the price is within your chosen range, but earn proportionally more than a
full-range position.

**Core concepts shared by all CLMM protocols (V3 and V4):**

- **Ticks, not bins.** Price ranges are defined by two tick values: `tickLower` and `tickUpper`.
  The price at any tick is `1.0001^tick`. Ticks are discrete integers.
- **Tick spacing.** Ticks must be multiples of the pool's tick spacing (e.g., spacing=60 means
  valid ticks are ...,-120,-60,0,60,120,...). Spacing is determined by the fee tier.
- **Position NFTs.** Both V3 and V4 represent positions as ERC-721 tokens. Each position has a
  unique token ID.
- **Fees accrue in position.** Trading fees accumulate automatically but must be explicitly
  collected. They are NOT auto-compounded.
- **Out of range = no fees.** If the current price moves outside your range, you earn nothing
  and hold 100% of one token.

**What differs between V3 and V4:** see the Version Routing section below.

## Version Routing

Three protocols are supported, each with different contract interfaces:

| Protocol | Version | When to use |
|----------|---------|-------------|
| Uniswap V4 | CLMM V4 | `deploymentStyle: "clmm-v4"` or user says "Uniswap V4" |
| Uniswap V3 | CLMM V3 | `deploymentStyle: "clmm-v3"` or user says "Uniswap V3" |
| PancakeSwap V3 | CLMM V3 | `dex: "PancakeSwap"` — always V3 on Monad |

**How to determine which version:**

1. Structured commands include `deploymentStyle: "clmm-v3"` or `"clmm-v4"`
2. Natural language: "Uniswap V4" → V4; "Uniswap V3" or "PancakeSwap" → V3
3. Pool data: `poolId` (bytes32) → V4; `poolAddress` (contract address) → V3
4. Default: if user says "Uniswap" without version and provides a pool address → V3; if
   provides a poolKey or poolId → V4

**Key architectural differences:**

| Aspect | V3 (Uniswap + PancakeSwap) | V4 (Uniswap only) |
|--------|---------------------------|-------------------|
| Pool identity | Separate contract per pool | Singleton PoolManager, pools identified by PoolKey hash |
| Position manager | `NonfungiblePositionManager` | `PositionManager` (different ABI, Actions system) |
| Token approvals | Standard `ERC20.approve()` to NFT manager | Via **Permit2** intermediary |
| Fee collection | Explicit `collect()` | `INCREASE_LIQUIDITY` with liquidity=0 |
| Native MON | Must wrap to WMON first | Native support via `address(0)` |
| Calldata | Direct function args | Packed action bytes + encoded params array |

---

## Contract Addresses (Monad Mainnet, Chain ID: 143)

### Uniswap V4

| Contract | Address |
|----------|---------|
| PoolManager | `0x188d586ddcf52439676ca21a244753fa19f9ea8e` |
| PositionManager | `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016` |
| StateView | `0x77395f3b2e73ae90843717371294fa97cc419d64` |
| Quoter | `0xa222dd357a9076d1091ed6aa2e16c9742dd26891` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

### Uniswap V3

| Contract | Address |
|----------|---------|
| Factory | `0x204faca1764b154221e35c0d20abb3c525710498` |
| NonfungiblePositionManager | `0x7197e214c0b767cfb76fb734ab638e2c192f4e53` |
| SwapRouter02 | `0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900` |
| QuoterV2 | `0x661e93cca42afacb172121ef892830ca3b70f08d` |
| TickLens | `0xf025e0fe9e331a0ef05c2ad3c4e9c64b625cda6f` |

### PancakeSwap V3

| Contract | Address |
|----------|---------|
| Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| NonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |
| SwapRouter | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| SmartRouter | `0x21114915Ac6d5A2e156931e20B20b038dEd0Be7C` |
| QuoterV2 | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` |
| TickLens | `0x9a489505a00cE272eAa5e07Dba6491314CaE3796` |

### Token Addresses

| Token | Address | Decimals |
|-------|---------|----------|
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | 18 |
| USDC | `0x754704bc059f8c67012fed69bc8a327a5aafb603` | 6 |
| USDT | `0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37` | 6 |

Native MON = `address(0)` in V4. Must wrap to WMON for V3.

---

## Tick Math

All CLMM protocols use the same tick math.

### Formulas

```
price = 1.0001^tick
tick = floor(log(price) / log(1.0001))
sqrtPriceX96 = sqrt(price) * 2^96
price = (sqrtPriceX96 / 2^96)^2
```

### Decimal Adjustment

Raw price is in smallest-unit terms. To get human-readable:

```
humanPrice = rawPrice * 10^(decimals0 - decimals1)
```

Example: MON (18 dec) / USDC (6 dec) at tick -316433:
```
rawPrice = 1.0001^(-316433) ≈ 1.79e-14
humanPrice = 1.79e-14 * 10^12 = 0.0179 USDC per MON
```

### Price to Tick (Reverse)

```
adjustedPrice = humanPrice / 10^(decimals0 - decimals1)
tick = floor(log(adjustedPrice) / log(1.0001))
```

### Range from Percentage

```bash
# Given current tick and desired range percentage:
CURRENT_TICK=-316433
RANGE_PCT=50  # ±50%
TICK_SPACING=60

TICKS_FOR_PCT=$(python3 -c "
import math
ticks = math.floor(math.log(1 + $RANGE_PCT/100) / math.log(1.0001))
print(ticks)
")

TICK_LOWER=$(python3 -c "
tick = $CURRENT_TICK - $TICKS_FOR_PCT
snapped = (tick // $TICK_SPACING) * $TICK_SPACING
print(snapped)
")

TICK_UPPER=$(python3 -c "
tick = $CURRENT_TICK + $TICKS_FOR_PCT
snapped = (tick // $TICK_SPACING) * $TICK_SPACING
print(snapped)
")

echo "Range: $TICK_LOWER to $TICK_UPPER"
```

### Fee Tiers and Tick Spacing

| Fee (bps) | Fee (%) | Tick Spacing | Use Case |
|-----------|---------|-------------|----------|
| 100 | 0.01% | 1 | Stablecoins |
| 500 | 0.05% | 10 | Correlated pairs |
| 2500 | 0.25% | 50 | PancakeSwap common |
| 3000 | 0.30% | 60 | Most pairs |
| 10000 | 1.00% | 200 | Exotic/volatile pairs |

V4 decouples fee from tick spacing (any combination is valid). V3 couples them (fee determines spacing).

### Token Ordering Rule

In all CLMM pools, `token0 < token1` numerically (compared as addresses).
- `address(0)` (native MON in V4) is always token0 since 0 < any address
- WMON (`0x3bd3...`) < USDC (`0xf817...`), so WMON is token0

---

## Pool Discovery

### V4: Compute Pool ID from PoolKey

V4 pools are identified by `PoolKey = (currency0, currency1, fee, tickSpacing, hooks)`:

```bash
STATE_VIEW="0x77395f3b2e73ae90843717371294fa97cc419d64"

# Compute PoolId = keccak256(abi.encode(PoolKey))
POOL_ID=$(cast keccak "$(cast abi-encode \
  'f((address,address,uint24,int24,address))' \
  '($CURRENCY0,$CURRENCY1,$FEE,$TICK_SPACING,$HOOKS)')")

# Verify pool exists (sqrtPriceX96 != 0)
SLOT0=$(cast call $STATE_VIEW \
  "getSlot0(bytes32)(uint160,int24,uint24,uint24)" $POOL_ID \
  --rpc-url $MONAD_RPC_URL)
SQRT_PRICE=$(echo "$SLOT0" | head -1)
if [ "$SQRT_PRICE" = "0" ]; then
  echo "Pool does not exist"
fi
```

### V3: Query Factory

```bash
# Uniswap V3
POOL=$(cast call 0x204faca1764b154221e35c0d20abb3c525710498 \
  "getPool(address,address,uint24)(address)" \
  $TOKEN0 $TOKEN1 $FEE --rpc-url $MONAD_RPC_URL)

# PancakeSwap V3
POOL=$(cast call 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865 \
  "getPool(address,address,uint24)(address)" \
  $TOKEN0 $TOKEN1 $FEE --rpc-url $MONAD_RPC_URL)

# address(0) = pool doesn't exist for that fee tier. Try other tiers.
```

---

## V4 Workflow: Deploy, Read, Withdraw

### V4 Actions System

All V4 liquidity operations go through a single function:

```
PositionManager.modifyLiquidities(bytes payload, uint256 deadline)
```

Where `payload = abi.encode(bytes actions, bytes[] params)`.

**Action constants:**

```
INCREASE_LIQUIDITY  = 0x00
DECREASE_LIQUIDITY  = 0x01
MINT_POSITION       = 0x02
BURN_POSITION       = 0x03
SETTLE_PAIR         = 0x0d
TAKE_PAIR           = 0x11
SWEEP               = 0x16
```

**Operation → action sequences:**

| Operation | Hex | Meaning |
|-----------|-----|---------|
| Deploy (ERC20) | `0x020d` | MINT + SETTLE_PAIR |
| Deploy (native MON) | `0x020d16` | MINT + SETTLE_PAIR + SWEEP |
| Increase | `0x000d` | INCREASE + SETTLE_PAIR |
| Collect fees | `0x0011` | INCREASE(0) + TAKE_PAIR |
| Decrease | `0x0111` | DECREASE + TAKE_PAIR |
| Full exit | `0x010311` | DECREASE + BURN + TAKE_PAIR |

### V4 Approval Setup (One-Time)

Before deploying on V4, approve tokens through Permit2:

```bash
PM="0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016"
PERMIT2="0x000000000022D473030F116dDEE9F6B43aC78BA3"

# Step 1: Approve token to Permit2 (infinite, one-time)
cast send $TOKEN "approve(address,uint256)" $PERMIT2 \
  "115792089237316195423570985008687907853269984665640564039457584007913129639935" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL

# Step 2: Approve PositionManager on Permit2 (one-time per token)
cast send $PERMIT2 "approve(address,address,uint160,uint48)" \
  $TOKEN $PM \
  "1461501637330902918203684832716283019655932542975" \
  "281474976710655" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

For native MON: no approvals needed -- send value with `--value`.

**Check existing approvals:**

```bash
# ERC20 allowance to Permit2
cast call $TOKEN "allowance(address,address)(uint256)" $WALLET $PERMIT2 --rpc-url $MONAD_RPC_URL

# Permit2 allowance to PositionManager
cast call $PERMIT2 "allowance(address,address,address)(uint160,uint48,uint48)" \
  $WALLET $TOKEN $PM --rpc-url $MONAD_RPC_URL
```

### V4 Deploy (Mint New Position)

```bash
PM="0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016"

# 1. Encode MINT_POSITION params
MINT_PARAMS=$(cast abi-encode \
  "f((address,address,uint24,int24,address),int24,int24,uint256,uint128,uint128,address,bytes)" \
  "($CURRENCY0,$CURRENCY1,$FEE,$TICK_SPACING,$HOOKS)" \
  "$TICK_LOWER" "$TICK_UPPER" "$LIQUIDITY" \
  "$AMOUNT0_MAX" "$AMOUNT1_MAX" "$RECIPIENT" "0x")

# 2. Encode SETTLE_PAIR params
SETTLE_PARAMS=$(cast abi-encode \
  "f(address,address)" "$CURRENCY0" "$CURRENCY1")

# 3. For native MON, also encode SWEEP params
SWEEP_PARAMS=$(cast abi-encode \
  "f(address,address)" \
  "0x0000000000000000000000000000000000000000" "$RECIPIENT")

# 4. Build full payload
#    ERC20 pair: actions=0x020d, 2 params
#    Native MON: actions=0x020d16, 3 params
PAYLOAD=$(cast abi-encode \
  "f(bytes,bytes[])" \
  "0x020d16" \
  "[$MINT_PARAMS,$SETTLE_PARAMS,$SWEEP_PARAMS]")

# 5. Send transaction
DEADLINE=$(($(date +%s) + 3600))
cast send $PM "modifyLiquidities(bytes,uint256)" \
  "$PAYLOAD" "$DEADLINE" \
  --value $MON_AMOUNT_WEI \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

**MINT_POSITION params:**
- `poolKey`: tuple of (currency0, currency1, fee, tickSpacing, hooks)
- `tickLower`, `tickUpper`: range boundaries (must be multiples of tickSpacing)
- `liquidity`: amount of liquidity units (use Quoter to calculate from token amounts)
- `amount0Max`, `amount1Max`: slippage protection (max tokens to spend)
- `recipient`: who receives the NFT
- `hookData`: `0x` for pools without hooks

### V4 Read Position

```bash
PM="0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016"
STATE_VIEW="0x77395f3b2e73ae90843717371294fa97cc419d64"

# Position liquidity
cast call $PM "getPositionLiquidity(uint256)(uint128)" $TOKEN_ID --rpc-url $MONAD_RPC_URL

# Pool key + position info
cast call $PM "getPoolAndPositionInfo(uint256)" $TOKEN_ID --rpc-url $MONAD_RPC_URL

# Position owner
cast call $PM "ownerOf(uint256)(address)" $TOKEN_ID --rpc-url $MONAD_RPC_URL

# Next token ID (predict tokenId before minting)
cast call $PM "nextTokenId()(uint256)" --rpc-url $MONAD_RPC_URL

# Count positions for wallet
cast call $PM "balanceOf(address)(uint256)" $WALLET --rpc-url $MONAD_RPC_URL

# Pool state: current price and tick
cast call $STATE_VIEW "getSlot0(bytes32)(uint160,int24,uint24,uint24)" $POOL_ID --rpc-url $MONAD_RPC_URL

# Pool total liquidity
cast call $STATE_VIEW "getLiquidity(bytes32)(uint128)" $POOL_ID --rpc-url $MONAD_RPC_URL
```

### V4 Withdraw (Decrease + Collect + Burn)

**Partial withdrawal:**

```bash
# DECREASE_LIQUIDITY + TAKE_PAIR (actions = 0x0111)
DEC_PARAMS=$(cast abi-encode \
  "f(uint256,uint256,uint128,uint128,bytes)" \
  "$TOKEN_ID" "$LIQUIDITY_TO_REMOVE" "0" "0" "0x")

TAKE_PARAMS=$(cast abi-encode \
  "f(address,address,address)" \
  "$CURRENCY0" "$CURRENCY1" "$RECIPIENT")

PAYLOAD=$(cast abi-encode "f(bytes,bytes[])" "0x0111" "[$DEC_PARAMS,$TAKE_PARAMS]")

DEADLINE=$(($(date +%s) + 3600))
cast send $PM "modifyLiquidities(bytes,uint256)" "$PAYLOAD" "$DEADLINE" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

**Collect fees only (no decrease):**

```bash
# INCREASE_LIQUIDITY(0) + TAKE_PAIR (actions = 0x0011)
# Passing liquidity=0 triggers fee collection without adding liquidity
INC_PARAMS=$(cast abi-encode \
  "f(uint256,uint256,uint128,uint128,bytes)" \
  "$TOKEN_ID" "0" \
  "340282366920938463463374607431768211455" \
  "340282366920938463463374607431768211455" "0x")

TAKE_PARAMS=$(cast abi-encode \
  "f(address,address,address)" \
  "$CURRENCY0" "$CURRENCY1" "$RECIPIENT")

PAYLOAD=$(cast abi-encode "f(bytes,bytes[])" "0x0011" "[$INC_PARAMS,$TAKE_PARAMS]")

DEADLINE=$(($(date +%s) + 3600))
cast send $PM "modifyLiquidities(bytes,uint256)" "$PAYLOAD" "$DEADLINE" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

**Full exit (decrease all + burn + collect):**

```bash
# DECREASE + BURN + TAKE_PAIR (actions = 0x010311)
# Get current liquidity first
LIQUIDITY=$(cast call $PM "getPositionLiquidity(uint256)(uint128)" $TOKEN_ID --rpc-url $MONAD_RPC_URL)

DEC_PARAMS=$(cast abi-encode \
  "f(uint256,uint256,uint128,uint128,bytes)" \
  "$TOKEN_ID" "$LIQUIDITY" "0" "0" "0x")

BURN_PARAMS=$(cast abi-encode \
  "f(uint256,uint128,uint128,bytes)" \
  "$TOKEN_ID" "0" "0" "0x")

TAKE_PARAMS=$(cast abi-encode \
  "f(address,address,address)" \
  "$CURRENCY0" "$CURRENCY1" "$RECIPIENT")

PAYLOAD=$(cast abi-encode "f(bytes,bytes[])" "0x010311" "[$DEC_PARAMS,$BURN_PARAMS,$TAKE_PARAMS]")

DEADLINE=$(($(date +%s) + 3600))
cast send $PM "modifyLiquidities(bytes,uint256)" "$PAYLOAD" "$DEADLINE" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

---

## V3 Workflow: Deploy, Read, Withdraw

V3 is simpler than V4 -- direct function calls instead of encoded actions. Both Uniswap V3
and PancakeSwap V3 use the **identical** NonfungiblePositionManager ABI (PCS is a fork).

Only the contract address differs:
- **Uniswap V3:** `0x7197e214c0b767cfb76fb734ab638e2c192f4e53`
- **PancakeSwap V3:** `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364`

### V3 Approval Setup (One-Time)

```bash
# Approve token to NonfungiblePositionManager (standard ERC20 approve)
cast send $TOKEN "approve(address,uint256)" $NFT_MANAGER \
  "115792089237316195423570985008687907853269984665640564039457584007913129639935" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL

# Check existing allowance
cast call $TOKEN "allowance(address,address)(uint256)" $WALLET $NFT_MANAGER --rpc-url $MONAD_RPC_URL
```

For native MON: V3 requires wrapping to WMON first:
```bash
WMON="0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A"
cast send $WMON "deposit()" --value $AMOUNT_WEI \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
# Then approve WMON to the NFT manager
```

### V3 Deploy (Mint New Position)

```bash
NFT_MANAGER="0x7197e214c0b767cfb76fb734ab638e2c192f4e53"  # Uniswap V3
# Or: NFT_MANAGER="0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"  # PancakeSwap V3

DEADLINE=$(($(date +%s) + 3600))

cast send $NFT_MANAGER \
  "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))" \
  "($TOKEN0,$TOKEN1,$FEE,$TICK_LOWER,$TICK_UPPER,$AMOUNT0_DESIRED,$AMOUNT1_DESIRED,$AMOUNT0_MIN,$AMOUNT1_MIN,$RECIPIENT,$DEADLINE)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

**mint params:**
- `token0`, `token1`: sorted token addresses (token0 < token1)
- `fee`: fee tier (100, 500, 2500, 3000, 10000)
- `tickLower`, `tickUpper`: range boundaries (multiples of tick spacing)
- `amount0Desired`, `amount1Desired`: target deposit amounts (in smallest units)
- `amount0Min`, `amount1Min`: slippage protection
- `recipient`: who receives the NFT
- `deadline`: unix timestamp

Returns: `(uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`

### V3 Read Position

```bash
# Full position data (12 return values)
cast call $NFT_MANAGER \
  "positions(uint256)(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)" \
  $TOKEN_ID --rpc-url $MONAD_RPC_URL

# Returns: nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity,
#          feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1

# Count positions for wallet
cast call $NFT_MANAGER "balanceOf(address)(uint256)" $WALLET --rpc-url $MONAD_RPC_URL

# Get token ID by index
cast call $NFT_MANAGER "tokenOfOwnerByIndex(address,uint256)(uint256)" $WALLET $INDEX --rpc-url $MONAD_RPC_URL

# Read pool state directly
cast call $POOL_ADDRESS "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url $MONAD_RPC_URL
cast call $POOL_ADDRESS "liquidity()(uint128)" --rpc-url $MONAD_RPC_URL
```

### V3 Withdraw (Decrease + Collect)

**CRITICAL:** V3 withdrawal is a TWO-STEP process. `decreaseLiquidity` marks tokens as owed
but does NOT transfer them. You MUST call `collect()` afterward to receive the tokens.

**Step 1: Decrease liquidity**

```bash
DEADLINE=$(($(date +%s) + 3600))
cast send $NFT_MANAGER \
  "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))" \
  "($TOKEN_ID,$LIQUIDITY,$AMOUNT0_MIN,$AMOUNT1_MIN,$DEADLINE)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

**Step 2: Collect tokens**

```bash
# Collect ALL owed tokens (use uint128.max for amounts)
cast send $NFT_MANAGER \
  "collect((uint256,address,uint128,uint128))" \
  "($TOKEN_ID,$RECIPIENT,340282366920938463463374607431768211455,340282366920938463463374607431768211455)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

The value `340282366920938463463374607431768211455` is `uint128.max` -- collects everything owed.

**Collect fees only (no decrease):**

```bash
# Just call collect() without decreasing -- collects only accrued fees
cast send $NFT_MANAGER \
  "collect((uint256,address,uint128,uint128))" \
  "($TOKEN_ID,$RECIPIENT,340282366920938463463374607431768211455,340282366920938463463374607431768211455)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

**Full exit (decrease all + collect + burn):**

```bash
# Get current liquidity
LIQUIDITY=$(cast call $NFT_MANAGER \
  "positions(uint256)(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)" \
  $TOKEN_ID --rpc-url $MONAD_RPC_URL | sed -n '8p')

DEADLINE=$(($(date +%s) + 3600))

# 1. Decrease all liquidity
cast send $NFT_MANAGER \
  "decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))" \
  "($TOKEN_ID,$LIQUIDITY,0,0,$DEADLINE)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL

# 2. Collect everything
cast send $NFT_MANAGER \
  "collect((uint256,address,uint128,uint128))" \
  "($TOKEN_ID,$RECIPIENT,340282366920938463463374607431768211455,340282366920938463463374607431768211455)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL

# 3. Burn empty NFT (optional, saves gas on future enumerations)
cast send $NFT_MANAGER "burn(uint256)" $TOKEN_ID \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

### V3 Increase Liquidity

```bash
DEADLINE=$(($(date +%s) + 3600))
cast send $NFT_MANAGER \
  "increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))" \
  "($TOKEN_ID,$AMOUNT0_DESIRED,$AMOUNT1_DESIRED,$AMOUNT0_MIN,$AMOUNT1_MIN,$DEADLINE)" \
  --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
```

---

## Range Strategies

### Narrow vs Wide Ranges

| Strategy | Range | Pros | Cons |
|----------|-------|------|------|
| Narrow (±5%) | ~1000 ticks | Maximum capital efficiency, highest fee APR | Frequent rebalancing, more IL |
| Medium (±25%) | ~5000 ticks | Good balance of efficiency and stability | Moderate rebalancing |
| Wide (±50%) | ~8000 ticks | Less rebalancing, lower IL risk | Lower fee APR |
| Full range | MIN_TICK to MAX_TICK | Never goes out of range | Same as V2, lowest efficiency |

### Choosing Fee Tiers

- **0.01% (spacing 1):** Stablecoin pairs (USDC/USDT). Extremely tight ranges viable.
- **0.05% (spacing 10):** Correlated assets. Moderate ranges.
- **0.30% (spacing 60):** Most volatile pairs (MON/USDC). Standard choice.
- **1.00% (spacing 200):** Exotic or very volatile pairs. Wide ranges required.

### Rebalancing Decision

Rebalance when the current tick moves outside your `tickLower`/`tickUpper`. The process is:

1. **Read current tick** (V4: StateView.getSlot0; V3: pool.slot0)
2. **Compare to position range** (from stored state)
3. **If out of range:**
   a. Withdraw all liquidity (decrease + collect for V3; full exit for V4)
   b. Compute new tick range centered on current tick
   c. Deploy new position with new range
   d. Update state file with new tokenId, tickLower, tickUpper

---

## State Management

Positions are tracked in `~/.openclaw/monadly-positions.json`. CLMM positions extend the
base schema with version-specific fields.

### V4 Position Entry

```json
{
  "id": "uniswapv4_mon_usdc_42",
  "dex": "Uniswap",
  "version": "v4",
  "pool": "MON/USDC",
  "poolId": "0x7d892749d0562b0f78a26cdec26e97ec9dc7f8d1997cb590643ab69f10a1da0e",
  "poolKey": {
    "currency0": "0x0000000000000000000000000000000000000000",
    "currency1": "0x754704bc059f8c67012fed69bc8a327a5aafb603",
    "fee": 3000,
    "tickSpacing": 60,
    "hooks": "0x0000000000000000000000000000000000000000"
  },
  "nftManager": "0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016",
  "tokenId": 42,
  "token0": "MON",
  "token1": "USDC",
  "token0Address": "0x0000000000000000000000000000000000000000",
  "token1Address": "0x754704bc059f8c67012fed69bc8a327a5aafb603",
  "token0Decimals": 18,
  "token1Decimals": 6,
  "feeTier": 3000,
  "tickSpacing": 60,
  "tickLower": -316500,
  "tickUpper": -316380,
  "rangeMode": "follow",
  "rebalanceFreq": "out-of-range",
  "lastRebalance": "2026-02-09T10:30:00Z",
  "cooldownMs": 60000,
  "createdAt": "2026-02-09T09:00:00Z"
}
```

### V3 Position Entry

Same structure except:
- `"version": "v3"`
- `"poolAddress": "0x659bD0BC4167BA25c62E05656F78043E7eD4a9da"` (the pool contract)
- No `poolId` or `poolKey` fields
- `"nftManager"` = Uniswap or PancakeSwap NFT manager address

### PancakeSwap V3 Entry

Same as V3 except:
- `"dex": "PancakeSwap"`
- `"nftManager": "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364"`

---

## Safety Rules (CLMM-Specific)

In addition to monadly-core's 12 non-negotiable safety rules, follow these CLMM-specific rules:

1. **Verify tick alignment.** tickLower and tickUpper MUST be exact multiples of the pool's
   tick spacing. A misaligned tick will cause the transaction to revert. Always snap:
   `tick = (tick // tickSpacing) * tickSpacing`

2. **Verify token ordering.** token0 < token1 always. Swapping the order creates a different
   pool (or reverts). For V4 with native MON, currency0 = address(0).

3. **V3: Always collect after decrease.** `decreaseLiquidity` does NOT send tokens back.
   You MUST call `collect()` afterward. Forgetting this leaves tokens stuck in the contract.

4. **V4: Include SWEEP for native token.** When dealing with native MON in V4, always append
   SWEEP action to return excess MON. Without it, excess MON stays in the PositionManager.

5. **V4: Check Permit2 approvals before every deploy.** Permit2 approvals can expire.
   Always verify before sending a transaction.

6. **Never rebalance during high volatility.** If the price has moved more than 10% in the
   last hour, wait. Rebalancing during a dump/pump crystallizes impermanent loss.

7. **Verify tokenId after mint.** After minting, verify the new tokenId by checking
   `ownerOf(tokenId)` matches your wallet. Store it immediately.

8. **Check pool exists before deploying.** V4: `getSlot0(poolId)` must return non-zero
   sqrtPriceX96. V3: factory `getPool()` must return non-zero address.

---

## Edge Cases

### Position Out of Range

When the current tick is outside your `[tickLower, tickUpper]`:
- Your position holds 100% of one token (all token0 if price went up, all token1 if down)
- You earn zero fees
- This is the trigger for rebalancing (if rangeMode = "follow")

### Tick Rounding

When computing ticks from prices, always round DOWN (floor) and then snap to tick spacing:

```python
import math
raw_tick = math.log(adjusted_price) / math.log(1.0001)
snapped = (int(raw_tick) // tick_spacing) * tick_spacing
```

For tickUpper, you may want to round UP to ensure the range includes the target price:

```python
snapped_upper = ((int(raw_tick) // tick_spacing) + 1) * tick_spacing
```

### Fee Tier Mismatch

If the user requests a fee tier that doesn't exist as a pool:
- V4: The pool simply won't be initialized (getSlot0 returns zeros)
- V3: Factory returns address(0)
- Response: Inform the user and suggest the nearest available fee tier

### V4 Dynamic Fee Pools

Some V4 pools use dynamic fees (fee = 0x800000 = 8388608). These pools have a hooks contract
that adjusts fees based on market conditions. The agent should:
- Detect dynamic fees from the PoolKey
- Read the current LP fee from `getSlot0` (4th return value)
- Note this in the position state

### Multiple USDC Tokens on Monad

The canonical USDC on Monad is `0x754704bc059f8c67012fed69bc8a327a5aafb603` (6 decimals).
All major DEXes (LFJ, Uniswap V3/V4, PancakeSwap V3) use this address.
Always verify the exact token addresses from the pool before constructing transactions.

---

## Key Constants

```
MAX_UINT256  = 115792089237316195423570985008687907853269984665640564039457584007913129639935
MAX_UINT160  = 1461501637330902918203684832716283019655932542975
MAX_UINT128  = 340282366920938463463374607431768211455
MAX_UINT48   = 281474976710655
MIN_TICK     = -887272
MAX_TICK     = 887272
```
