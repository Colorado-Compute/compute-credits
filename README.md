# Compute credits

![Compute credits: 170 rows in six lanes](assets/hero.svg)

## [➡️ Open the Credits Explorer](https://colorado-compute.github.io/compute-credits/)

![rows](https://img.shields.io/badge/rows-170-0969da) ![free rows](https://img.shields.io/badge/free_rows-66-2da44e) ![lanes](https://img.shields.io/badge/lanes-6-8250df) ![newest check](https://img.shields.io/badge/checked-2026--11--24-gray)

The one public catalog of free credits, free tiers and subsidized subscriptions. You need no startup and no company. Published by [Colorado-Compute](https://github.com/Colorado-Compute) under [Apache-2.0](LICENSE).

| Lane | Rows | Free rows |
| --- | --- | --- |
| ⚙️ ci | 12 | 8 |
| 🖥️ cpu | 35 | 13 |
| 🎮 gpu | 41 | 9 |
| 🧠 inference | 36 | 15 |
| ☁️ hosting | 18 | 12 |
| 🧰 tools | 28 | 9 |
| **All** | **170** | **66** |

Counts are by each row's first lane, from [`catalog/plans.json`](catalog/plans.json). A free row has `price_month` 0. [`catalog/README.md`](catalog/README.md) lists the fields and commands. The catalog moved here from [SoulCraft-Org/compute-crafter](https://github.com/SoulCraft-Org/compute-crafter) on 2026-11-24 and replaced the 28-row `credits.json`.

```mermaid
flowchart LR
  P[Pick a lane] --> S[Sign up on the vendor page]
  S --> L[Sign in with the vendor CLI]
  L --> G[Set the vendor spend stop]
  G --> R[Run]
```

Steps are in [`guides/setup-template.md`](guides/setup-template.md).

## Three doors

| Door | Repo | Use |
| --- | --- | --- |
| 🚀 | [Colorado-Startups/startup-credits](https://github.com/Colorado-Startups/startup-credits) | Apply as a company: credits that need a company, funding or an invitation, and a matcher |
| 💳 | This repo | Sign up or subscribe, as anyone |
| 🔌 | [SoulCraft-Org/compute-crafter](https://github.com/SoulCraft-Org/compute-crafter) | Wire open-weight models into OpenCode and Claude Code |

## Rules

- First-party pages only: each row's `source` is the vendor page.
- Read dates: `checked` is the day someone read that page.
- No key values: sign in with the vendor CLI, never a key in a command.
- Set the vendor's spend stop at the included amount.
- No vendor paid to appear, and Colorado-Compute is no vendor's partner. The list leaves out some vendors by policy.

## Fix a row

Open a pull request that edits `catalog/plans.json`. Set `source` to the vendor page you read and `checked` to today. Run `python3 -I tools/catalog.py --format`, then `--check`. CI runs every check. `tools/` holds `catalog.py`, which builds and checks the catalog, and `checks.py`, which runs the text checks and the secret scan.
