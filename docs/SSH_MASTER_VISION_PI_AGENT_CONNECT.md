# SSH — Master ↔ Vision Pi (coding agents)

Shared connection guide for Cursor/coding agents working across the two Raspberry Pis. Coordination docs also live on the Vision Pi under:

`/home/bot/inspection_vision/master_controller&Vision_Pi_behavior_update/`

---

## Machines

| Role | Host | User | Repo path |
|------|------|------|-----------|
| **Master** (US Machine HMI) | `192.168.10.1` | `bot` | `/home/bot/US Machine` |
| **Vision Pi** (inspection_vision) | `192.168.10.2` | `bot` | `/home/bot/inspection_vision` |

Password (both): `Gajoute1992`

---

## Agent on Vision Pi → connect to Master

```bash
ssh bot@192.168.10.1
```

- Password: `Gajoute1992`
- After login, work in: `/home/bot/US Machine`
- Example:

```bash
ssh bot@192.168.10.1
cd "/home/bot/US Machine"
```

Non-interactive copy from Vision Pi to Master:

```bash
scp ./some-file.md 'bot@192.168.10.1:/home/bot/US Machine/docs/'
```

---

## Agent on Master → connect to Vision Pi

```bash
ssh bot@192.168.10.2
```

- Password: `Gajoute1992`
- After login, work in: `/home/bot/inspection_vision`
- Example:

```bash
ssh bot@192.168.10.2
cd /home/bot/inspection_vision
```

Non-interactive copy from Master to Vision Pi:

```bash
scp "/home/bot/US Machine/docs/SOME_DOC.md" \
  'bot@192.168.10.2:/home/bot/inspection_vision/master_controller&Vision_Pi_behavior_update/Current_Master/'
```

---

## Coordination folder (Vision Pi)

```text
/home/bot/inspection_vision/master_controller&Vision_Pi_behavior_update/
```

Use this tree for cross-repo handoff docs (behavior updates, current master contracts, etc.). Paths containing `&` must be quoted in shell commands.

| Subfolder (typical) | Purpose |
|---------------------|---------|
| `Current_Master/` | Docs describing current master behavior / contracts |

---

## Tips for agents

1. Prefer quoted paths when spaces or `&` appear (`US Machine`, `master_controller&Vision_Pi_behavior_update`).
2. First SSH may prompt for host key — accept if the LAN address matches the table above.
3. For scripts without a TTY, use `sshpass` (if installed):  
   `sshpass -p 'Gajoute1992' ssh -o StrictHostKeyChecking=accept-new bot@192.168.10.2 '…'`
4. Do not commit this password into public remotes; keep this file on the LAN machines / private coordination folder only.
