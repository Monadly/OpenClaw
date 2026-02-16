---
name: security-hardening
description: |
  Defense-in-depth security hardening and incident response for Monadly DeFi operations on Monad.
  Private key deep hardening (shell history, process list, clipboard, screen recording, Foundry keystore),
  server hardening (14 items: SSH, firewall, non-root, disk encryption, Tailscale, backups, fail2ban),
  wallet hygiene (test vs production wallets, weekly approval audit), emergency incident response
  (key compromise, wallet drain, system breach, unexpected approvals, wrong network).
  Use when: the user wants to harden their setup, run a security audit, lock down their server,
  respond to a security incident, or perform periodic security hygiene reviews. Not for: basic wallet
  setup or operational safety rules (those are in monadly-core). This skill adds layers beyond the
  operational minimum for production deployments with real funds.
user-invocable: true
source: https://github.com/Monadly/OpenClaw/blob/main/skills/security-hardening_SKILL.md
metadata: {"openclaw": {"requires": {"bins": ["cast"]}}}
---

# Security Hardening — Defense-in-Depth for Monadly

This skill contains recommended security hardening measures for machines running Monadly
DeFi operations. These are **not mandatory for basic operation** — monadly-core covers the
operational minimum (env vars, file permissions, gas reserves). This skill adds layers of
defense for production deployments where real funds are at stake.

**When to use this skill:**
- User says "harden my setup", "security audit", "lock down my server"
- User asks about advanced key protection, server security, or incident response
- After initial wallet setup, when moving from testing to production
- Periodically, for security hygiene reviews

**Prerequisite:** monadly-core must be configured first (wallet, .env, environment variables).

## Index

| Section | What it covers |
|---------|---------------|
| [1. Private Key Hardening](#1-private-key-hardening) | Shell history, process list, env var leakage, clipboard, screen recording, file permissions |
| [2. Server Hardening](#2-server-hardening) | S1–S14: SSH, firewall, non-root, disk encryption, updates, Tailscale, backups, reboot, integrity |
| [3. Wallet Hygiene](#3-wallet-hygiene) | Test vs production wallets, approval management, weekly audit checklist |
| [4. Incident Response](#4-incident-response) | Key compromise, emergency drain, unexpected approvals, stuck tx, wrong network, system breach |
| [5. Defense-in-Depth Checklist](#5-defense-in-depth-checklist) | Quick-reference summary across private key, server, wallet, and operational layers |

---

## 1. Private Key Hardening

monadly-core enforces the operational basics: use `$MONAD_PRIVATE_KEY` env var, never
inline keys, chmod 600 on `.env`. This section goes deeper.

### Shell History Protection

Shell history is the #1 accidental key leak vector. Even with `$MONAD_PRIVATE_KEY`, a
user might accidentally type a raw key during setup or debugging.

**Add to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.zprofile`):**

```bash
# Bash
export HISTIGNORE="*PRIVATE_KEY*:*private_key*:*0x*:*cast wallet import*"

# Zsh
export HISTORY_IGNORE="(*PRIVATE_KEY*|*private_key*|*0x*|*cast wallet import*)"
```

This prevents shell history from recording any command containing private key material.

**If a key was already recorded in history:**

```bash
# Bash — delete the offending entry
history -d $(history | grep "PRIVATE_KEY\|0x" | tail -1 | awk '{print $1}')

# Zsh — write history then manually edit
fc -W
# Then edit ~/.zsh_history to remove the line containing the key
```

If the key was exposed in a shared terminal or recorded session, treat it as compromised
and follow the Incident Response procedures below.

### Process List Protection

Private keys passed as command-line arguments are visible in `ps aux` output to all users
on the system. Environment variables are NOT visible in `ps aux`.

**Rule:** Always use `$MONAD_PRIVATE_KEY` (environment variable), never the raw value.

```bash
# SAFE — environment variable, not visible in ps aux
cast send ... --private-key $MONAD_PRIVATE_KEY

# DANGEROUS — raw key visible to all users via ps aux
cast send ... --private-key 0xac0974bec39a17e36ba...
```

If the key was visible in the process list on a shared machine, rotate the key immediately.

### Environment Variable Leakage

Environment variables can leak through:
- `/proc/[pid]/environ` on Linux (readable by same user)
- `ps eww` on some systems
- Core dumps
- Child processes inheriting the environment

**Mitigation — Monad Foundry Keystore Alternative:**

Instead of storing the raw private key in an environment variable, use Monad Foundry's encrypted
keystore:

```bash
# Import key to encrypted keystore (prompted for password)
cast wallet import monadly --interactive

# Use keystore instead of --private-key
cast send ... --account monadly
# You will be prompted for the keystore password
```

This keeps the private key encrypted on disk and never in plaintext in environment variables.
The tradeoff is that automated (unattended) operations require the password, which must itself
be stored somewhere.

**Restrict `/proc` access on Linux:**

```bash
# /etc/sysctl.d/10-ptrace.conf
kernel.yama.ptrace_scope = 1
```

This prevents non-root users from reading other users' process environments.

### Clipboard Sniffing Prevention

Clipboard contents can be read by any application on the system.

- **Clear clipboard after pasting a private key:**
  ```bash
  # macOS
  pbcopy < /dev/null

  # Linux (X11)
  xclip -selection clipboard < /dev/null

  # Linux (Wayland)
  wl-copy ""
  ```
- **Never leave a private key in the clipboard.** Paste it, then immediately clear.
- **Use a clipboard manager with auto-clear** (e.g., set clipboard to auto-clear after 30
  seconds)
- **On headless servers:** Clipboard is not typically a concern, but be aware of remote desktop
  tools (VNC, RDP) that may share clipboard with the local machine.

### Screen Recording Awareness

If the machine runs screen recording software, streams, or has an open remote desktop session:

- **Disable screen recording** before performing any wallet operations
- **Close remote desktop sessions** (VNC, RDP, screen sharing) before handling private keys
- **Check for active screen sharing:**
  ```bash
  # macOS — check for screen recording processes
  ps aux | grep -i "screen\|record\|vnc\|share"

  # Linux — check for VNC or screen capture
  ps aux | grep -i "vnc\|x11vnc\|ffmpeg\|obs"
  ```
- **If in doubt, assume you are being recorded.** Never display private keys.

### File Permission Deep Dive

Beyond the basic `chmod 600 ~/.openclaw/.env`:

```bash
# The directory itself should be 700 (owner only)
chmod 700 ~/.openclaw

# All state files should be 600
chmod 600 ~/.openclaw/.env
chmod 600 ~/.openclaw/monadly-positions.json
chmod 600 ~/.openclaw/monadly-tx-log.json

# Never commit .env to git
echo ".env" >> ~/.openclaw/.gitignore
```

**Verify permissions regularly:**

```bash
# Should return nothing (no world-readable files)
find ~/.openclaw -perm /o+r -ls

# Should return nothing (no files owned by other users)
find ~/.openclaw -not -user $(whoami) -ls
```

---

## 2. Server Hardening

These rules apply to the physical or virtual machine running OpenClaw. Whether it is a Mac
Mini under a desk, a Linux VPS, or a home server, these hardening steps reduce the attack
surface.

### S1: SSH Hardening

Disable password authentication. Use SSH keys only.

```bash
# /etc/ssh/sshd_config
PasswordAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 30
```

After editing, restart SSH:
```bash
sudo systemctl restart sshd
```

Ensure you have your SSH key added to `~/.ssh/authorized_keys` BEFORE disabling password auth.
Lock yourself out and you lose access.

### S2: Firewall Rules

Only expose necessary ports. Block everything else.

```bash
# UFW example
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 443/tcp          # HTTPS (Caddy)
# DO NOT expose 8545 (RPC), 5433 (Postgres), 3000, 3001 directly
sudo ufw enable
```

If using Tailscale, you can restrict SSH and management ports to Tailscale IPs only:
```bash
sudo ufw allow from 100.64.0.0/10 to any port 22
```

### S3: Run as Non-Root User

Create a dedicated user for OpenClaw operations:

```bash
sudo adduser openclaw --disabled-password
sudo usermod -aG docker openclaw  # If Docker access needed
```

Run OpenClaw services under this user, not root. Private keys stored in
`/home/openclaw/.openclaw/.env` are isolated from other users.

**If running as root (current setup):** Acknowledge the risk. Root compromise means full system
compromise including all private keys. Plan migration to a dedicated user.

### S4: Disk Encryption

Enable full-disk encryption to protect private keys at rest.

- **macOS:** Enable FileVault in System Preferences > Security & Privacy
- **Linux:** Use LUKS for full-disk encryption at install time, or encrypt the `.openclaw`
  directory:
  ```bash
  # Encrypt a directory with gocryptfs
  sudo apt install gocryptfs
  mkdir ~/.openclaw-encrypted ~/.openclaw
  gocryptfs -init ~/.openclaw-encrypted
  gocryptfs ~/.openclaw-encrypted ~/.openclaw
  ```

If the disk is stolen or the machine is physically accessed while powered off, encrypted data
is unreadable.

### S5: Automatic Updates

Keep Monad Foundry and OpenClaw up to date. Vulnerabilities in older versions can be exploited.

```bash
# Update Monad Foundry
foundryup --network monad

# Update OpenClaw
openclaw update

# System updates (Ubuntu/Debian)
sudo apt update && sudo apt upgrade -y

# macOS
softwareupdate --install --all
```

Schedule weekly update checks via cron or launchd. Do not auto-restart services after updates
without testing.

### S6: Tailscale Security

If using Tailscale for remote access:

- **Configure ACLs** in the Tailscale admin console to restrict which devices can access the
  OpenClaw machine
- **Enable device authorization** — new devices must be manually approved before joining the
  tailnet
- **Use Tailscale SSH** instead of exposing port 22 to the public internet:
  ```bash
  tailscale up --ssh
  ```
- **Set key expiry** — do not use non-expiring keys. Re-authenticate periodically.
- **Review connected devices** monthly. Remove any devices that are no longer in use.

### S7: Physical Security

- Keep the machine in a **locked room or cabinet** if it holds production private keys
- Enable **automatic screen lock** after 2 minutes of inactivity
- Enable **auto-lock on lid close** (for Mac Mini with external display)
- If using a Mac Mini: disable automatic login, require password on wake
- Consider a **Kensington lock** for physical theft prevention

### S8: Backup Strategy

- **Encrypt all backups** before storing them anywhere. Never back up `~/.openclaw/.env`
  in plaintext.
  ```bash
  # Encrypt with GPG
  gpg --symmetric --cipher-algo AES256 ~/.openclaw/.env
  # Creates ~/.openclaw/.env.gpg
  ```
- **Store backups offsite** — a different physical location or encrypted cloud storage
  (e.g., encrypted S3 bucket, not plain Google Drive)
- **Test backup restoration** quarterly. A backup you cannot restore is not a backup.
- **Version backups** with dates:
  ```bash
  cp ~/.openclaw/.env.gpg ~/backups/openclaw-env-$(date +%Y%m%d).gpg
  ```

### S9: Unattended Reboot

Ensure services restart automatically after power failure or reboot.

**Linux (systemd):**
```bash
sudo systemctl enable openclaw.service
# Verify:
sudo systemctl is-enabled openclaw.service
# Expected: enabled
```

**macOS (launchd):**
```xml
<!-- ~/Library/LaunchAgents/com.openclaw.agent.plist -->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/openclaw</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

**CRITICAL:** After reboot, environment variables from `~/.openclaw/.env` must be loaded.
Ensure the service file or launch agent sources the `.env` file, or use `EnvironmentFile=`
in systemd.

### S10: Skill File Integrity

Verify that skill files have not been tampered with. A modified skill file could exfiltrate
private keys.

```bash
# Generate checksums after initial setup
sha256sum ~/.openclaw/skills/**/*.md > ~/.openclaw/skills.sha256

# Verify integrity before running
sha256sum -c ~/.openclaw/skills.sha256
```

If any checksum fails:
1. Do NOT run the modified skill
2. Investigate what changed and why
3. Re-download the skill from a trusted source
4. Re-generate checksums

Set the skill files to read-only:
```bash
chmod 444 ~/.openclaw/skills/**/*.md
```

### S11: Remote Access Hardening

Beyond SSH (S1), harden all remote access points:

**fail2ban — block brute-force attempts:**
```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban

# /etc/fail2ban/jail.local
[sshd]
enabled = true
maxretry = 3
bantime = 3600
findtime = 600
```

**Two-Factor Authentication (2FA):**
```bash
# Install Google Authenticator PAM module
sudo apt install libpam-google-authenticator
google-authenticator  # Follow prompts

# Add to /etc/pam.d/sshd:
auth required pam_google_authenticator.so

# Add to /etc/ssh/sshd_config:
AuthenticationMethods publickey,keyboard-interactive
KbdInteractiveAuthentication yes
```

**Login alerts — get notified on successful SSH login:**
```bash
# Add to /etc/profile or ~/.bashrc
if [ -n "$SSH_CONNECTION" ]; then
  echo "SSH login: $(whoami)@$(hostname) from ${SSH_CONNECTION%% *} at $(date)" | \
    mail -s "SSH Login Alert" your@email.com
fi
```

Or use a webhook (Telegram, Slack, etc.) instead of email for faster notification.

### S12: Session Persistence Across Reboots

Ensure wallet configuration survives reboots and service restarts.

- **`~/.openclaw/.env` must be on persistent storage.** Not `/tmp`, not a RAM disk.
- **Systemd services** should use `EnvironmentFile=`:
  ```ini
  [Service]
  EnvironmentFile=/home/openclaw/.openclaw/.env
  ExecStart=/usr/local/bin/openclaw start
  ```
- **After reboot, verify:**
  ```bash
  # Check env vars are loaded
  cast wallet address --private-key $MONAD_PRIVATE_KEY
  cast chain-id --rpc-url $MONAD_RPC_URL
  ```
- **Test reboot recovery:** Intentionally reboot the machine and verify all services come back
  up with correct wallet configuration. Do this during initial setup, not during a production
  incident.

### S13: Multi-User Machine Isolation

If multiple users share the same machine:

- **Each user gets their own `~/.openclaw/` directory** with `chmod 700`:
  ```bash
  chmod 700 ~/.openclaw
  chmod 600 ~/.openclaw/.env
  ```
- **Ensure `/proc/[pid]/environ` is restricted:**
  ```bash
  # /etc/sysctl.d/10-ptrace.conf
  kernel.yama.ptrace_scope = 1
  ```
  This prevents non-root users from reading other users' process environments.
- **Do not use shared environment variables** (e.g., system-wide `/etc/environment`). Each
  user's keys must be isolated.
- **Audit file permissions** regularly:
  ```bash
  find ~/.openclaw -not -user $(whoami) -ls  # Should return nothing
  find ~/.openclaw -perm /o+r -ls            # Should return nothing
  ```

### S14: Supply Chain Attack Prevention

Protect against compromised dependencies and tools.

- **Verify Monad Foundry installation** — only install from the official source:
  ```bash
  curl -L https://raw.githubusercontent.com/category-labs/foundry/monad/foundryup/install | bash
  foundryup --network monad
  ```
  Do not install Foundry from unverified third-party sources or mirrors.

- **Pin tool versions** when stability matters:
  ```bash
  foundryup --network monad --version v1.5.0-monad.0.1.0
  ```

- **Verify OpenClaw skill checksums** (see S10) before running after any update.

- **Review skill file changes** before accepting updates. Read the diff:
  ```bash
  diff ~/.openclaw/skills/monadly-core/SKILL.md ~/downloads/new-SKILL.md
  ```

- **Do not install untrusted OpenClaw skills.** Only use skills from the official Monadly
  repository or skills you have personally reviewed.

- **Monitor for dependency confusion** — if a skill references external packages or URLs,
  verify they point to legitimate sources before running.

---

## 3. Wallet Hygiene

### Separation of Concerns

1. **Use separate wallets for testing and production.** Never test contracts or new strategies
   with a wallet that holds significant funds. Create a dedicated test wallet with a small
   amount of MON.

2. **Start with small amounts.** When deploying liquidity for the first time on a new pool or
   DEX, start with a small test amount (e.g., $10 worth). Verify the operation succeeds and
   can be reversed before committing larger sums.

3. **Keep a gas reserve.** Always maintain at least 10 MON in the wallet for gas fees. Never
   wrap, swap, or deploy your entire native balance. monadly-core enforces this, but verify
   manually during audits.

4. **Consider Circle wallet for USDC custody.** If you hold significant USDC, a Circle
   Developer-Controlled Wallet removes the raw private key from your server entirely — Circle
   custodies it. This is especially useful for USDC-heavy operations where you want an extra
   layer of key protection. See monadly-core Wallet Setup Option 3 for setup instructions.
   Trade-off: DeFi operations (liquidity, swaps) still require a standard wallet with a local
   key, so Circle is best used alongside — not instead of — your operational wallet.

### Approval Management

4. **Regularly audit approvals.** At minimum, check all token approvals weekly. For active
   trading wallets, check before every session:
   ```bash
   # Check allowance for a specific token and spender
   cast call $TOKEN "allowance(address,address)(uint256)" $WALLET $SPENDER --rpc-url $MONAD_RPC_URL
   ```

5. **Revoke unused approvals.** If you are no longer interacting with a contract, revoke its
   approval immediately:
   ```bash
   cast send $TOKEN "approve(address,uint256)" $SPENDER 0 \
     --private-key $MONAD_PRIVATE_KEY --rpc-url $MONAD_RPC_URL
   ```
   Every outstanding approval is an attack surface. Minimize them.

6. **Track which contracts have approvals.** Maintain awareness of every contract authorized
   to spend your tokens. When a new approval is granted, note it. When it is no longer needed,
   revoke it.

### Weekly Security Audit Checklist

Run this checklist weekly for active wallets:

1. Check file permissions: `ls -la ~/.openclaw/.env` (must be `-rw-------`)
2. Audit token approvals for all known spender contracts
3. Verify shell history protection is active (`echo $HISTIGNORE`)
4. Check for unexpected processes: `ps aux | grep -i "key\|wallet\|cast"`
5. Review SSH access logs: `last` and `journalctl -u sshd`
6. Verify Monad Foundry is up to date: `cast --version`
7. Check state file integrity: `sha256sum -c ~/.openclaw/skills.sha256`

---

## 4. Incident Response

### Private Key Compromised

**Severity: CRITICAL. Act immediately.**

1. Execute the Emergency Wallet Drain Procedure (below) from a trusted machine
2. Generate a new wallet: `cast wallet new`
3. Update `~/.openclaw/.env` with the new credentials
4. Investigate how the key was compromised:
   - Check shell history: `history | grep -i "key\|0x\|private"`
   - Check SSH access logs: `last` and `journalctl -u sshd`
   - Check file modification times: `ls -la ~/.openclaw/`
   - Check for unauthorized processes: `ps aux`
5. Harden the attack vector (fix the root cause)
6. Notify any parties who may be affected

### Emergency Wallet Drain Procedure

If you suspect your private key or machine has been compromised, drain the wallet immediately.

**Steps:**

1. **Do NOT wait to investigate.** Every second counts. Drain first, investigate later.

2. **From a DIFFERENT, trusted machine**, send all tokens to a safe wallet:
   ```bash
   # Check current balance
   cast balance $COMPROMISED_ADDRESS --rpc-url $MONAD_RPC_URL --ether

   # Calculate drain amount (balance minus gas for the drain tx)
   BALANCE=$(cast balance $COMPROMISED_ADDRESS --rpc-url $MONAD_RPC_URL)
   GAS_COST=$(cast estimate $SAFE_WALLET_ADDRESS --value $BALANCE --rpc-url $MONAD_RPC_URL)
   DRAIN_AMOUNT=$((BALANCE - GAS_COST * 2))  # 2x gas for safety margin

   # Send native MON to safe wallet
   cast send $SAFE_WALLET_ADDRESS \
     --value $DRAIN_AMOUNT \
     --private-key $COMPROMISED_PRIVATE_KEY \
     --rpc-url $MONAD_RPC_URL

   # For each ERC20 token with balance, transfer to safe wallet
   cast send $TOKEN_ADDRESS "transfer(address,uint256)" $SAFE_WALLET_ADDRESS $TOKEN_BALANCE \
     --private-key $COMPROMISED_PRIVATE_KEY \
     --rpc-url $MONAD_RPC_URL
   ```

3. **Revoke all approvals** from the compromised wallet (if gas remains):
   ```bash
   cast send $TOKEN "approve(address,uint256)" $SPENDER 0 \
     --private-key $COMPROMISED_PRIVATE_KEY \
     --rpc-url $MONAD_RPC_URL
   ```

4. **Remove all LP positions** before the attacker can:
   ```bash
   # Use the DEX skill to remove liquidity
   # This is time-critical — LP positions can be drained by the attacker
   ```

5. **After draining:**
   - Generate a new wallet: `cast wallet new`
   - Update `~/.openclaw/.env` with the new key and address
   - Never reuse the compromised key
   - Investigate the compromise (check logs, SSH access, file modifications)

### Unexpected Approval

**Severity: HIGH. Revoke within minutes.**

If you discover an approval you did not authorize, or an approval to an unknown contract:

1. **Revoke immediately:**
   ```bash
   cast send $TOKEN "approve(address,uint256)" $SUSPICIOUS_SPENDER 0 \
     --private-key $MONAD_PRIVATE_KEY \
     --rpc-url $MONAD_RPC_URL
   ```

2. **Check if any tokens were already drained:**
   ```bash
   cast call $TOKEN "balanceOf(address)(uint256)" $MONAD_WALLET_ADDRESS --rpc-url $MONAD_RPC_URL
   ```

3. **If tokens were drained**, this may indicate a compromised key. Follow the Private Key
   Compromised procedure above.

4. **Audit all other token approvals** to check for additional unauthorized approvals.

### Transaction Stuck

**Severity: MEDIUM. Address within minutes.**

1. Check if the transaction is actually pending:
   ```bash
   cast receipt $TX_HASH --rpc-url $MONAD_RPC_URL
   ```
   If a receipt exists, the transaction is not stuck — it either succeeded or reverted.

2. If no receipt (truly pending), check the mempool and gas price:
   ```bash
   cast gas-price --rpc-url $MONAD_RPC_URL
   ```

3. Speed up by re-sending with higher gas (same nonce):
   ```bash
   cast send $TO_ADDRESS $CALLDATA \
     --nonce $STUCK_NONCE \
     --gas-price $(cast gas-price --rpc-url $MONAD_RPC_URL | awk '{print $1 * 1.5}') \
     --private-key $MONAD_PRIVATE_KEY \
     --rpc-url $MONAD_RPC_URL
   ```

4. If speed-up fails, cancel by sending a zero-value self-transaction:
   ```bash
   cast send $MONAD_WALLET_ADDRESS \
     --value 0 \
     --nonce $STUCK_NONCE \
     --gas-price $(cast gas-price --rpc-url $MONAD_RPC_URL | awk '{print $1 * 2}') \
     --private-key $MONAD_PRIVATE_KEY \
     --rpc-url $MONAD_RPC_URL
   ```

### Wrong Network

**Severity: LOW (if caught before sending). HIGH (if transaction sent to wrong network).**

1. **Before sending:** Always verify chain ID:
   ```bash
   cast chain-id --rpc-url $MONAD_RPC_URL
   # Must return: 143
   ```

2. **If a transaction was sent to the wrong network:**
   - The transaction used gas on that network, not Monad
   - Tokens may have been sent to a contract that does not exist on that network
   - If the contract address exists on the wrong network, tokens may be stuck in an
     unrelated contract
   - Recovery depends on the specific situation. In most cases, tokens sent to the wrong
     network are unrecoverable.

3. **Fix the RPC URL:**
   ```bash
   # Update ~/.openclaw/.env
   MONAD_RPC_URL=https://rpc.monad.xyz

   # Verify
   cast chain-id --rpc-url $MONAD_RPC_URL
   # Must return: 143
   ```

### System Breach

**Severity: CRITICAL. Assume all keys are compromised.**

If you suspect unauthorized access to the machine running OpenClaw:

1. **Execute Emergency Wallet Drain immediately** from a different, trusted machine
2. **Disconnect the compromised machine from the network:**
   ```bash
   sudo ifconfig eth0 down  # Or unplug the ethernet cable
   ```
3. **Do NOT shut down the machine** — preserve memory and logs for forensic analysis
4. **From another machine, check access logs:**
   - SSH: `last`, `journalctl -u sshd`
   - File changes: `find / -mtime -1 -type f` (files modified in last 24 hours)
   - New user accounts: `cat /etc/passwd`
   - Cron jobs: `crontab -l`, `ls /etc/cron.d/`
   - Running processes: `ps aux`
   - Network connections: `ss -tunap`
5. **After investigation:**
   - Rebuild the machine from a clean image if compromise is confirmed
   - Generate new SSH keys
   - Generate new wallet
   - Update all credentials (RPC API keys, Tailscale keys, etc.)
   - Review and apply all hardening steps (S1-S14)

---

## 5. Defense-in-Depth Checklist

Quick reference summary of all hardening steps. Use this as a setup checklist for new
deployments or a periodic audit guide.

### Private Key Layer

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | .env permissions | `ls -la ~/.openclaw/.env` | `-rw-------` |
| 2 | Directory permissions | `ls -la -d ~/.openclaw/` | `drwx------` |
| 3 | HISTIGNORE set | `echo $HISTIGNORE` | Contains `*PRIVATE_KEY*` |
| 4 | No keys in history | `history \| grep "0x"` | Empty |
| 5 | No keys in processes | `ps aux \| grep "private"` | No raw keys |

### Server Layer

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 6 | SSH password auth disabled | `grep PasswordAuth /etc/ssh/sshd_config` | `no` |
| 7 | Firewall active | `sudo ufw status` | `active` |
| 8 | Non-root user | `whoami` | Not `root` |
| 9 | Disk encryption | OS-specific check | Enabled |
| 10 | fail2ban active | `sudo systemctl status fail2ban` | `active` |
| 11 | Monad Foundry version current | `cast --version` | Recent |
| 12 | Auto-restart enabled | `systemctl is-enabled openclaw` | `enabled` |

### Wallet Layer

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 13 | Gas reserve adequate | `cast balance $ADDR --ether` | > 10 MON |
| 14 | No stale approvals | Audit loop (see Wallet Hygiene) | All intentional |
| 15 | Wallet matches key | `cast wallet address --private-key $KEY` | Matches .env |
| 16 | Chain ID correct | `cast chain-id --rpc-url $RPC` | `143` |

### Operational Layer

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 17 | Skill checksums valid | `sha256sum -c ~/.openclaw/skills.sha256` | All OK |
| 18 | State files intact | Parse JSON test | Valid JSON |
| 19 | Backup exists | `ls ~/.openclaw/.env.bak` | File exists |
| 20 | SSH logs clean | `last \| head -20` | Known IPs only |
