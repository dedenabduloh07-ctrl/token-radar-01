# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dedenabduloh07-ctrl/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dedenabduloh07-ctrl/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every protocol that records no token by what its launch would be worth, each with the steps to farm it. It reads a sealed DefiLlama snapshot, covers the whole watchlist, adds every pre-token protocol below the floor that is not a wrapped, staked or bridged product, and scores each one with a value model calibrated from the market itself: the median market-cap-to-TVL multiple of the snapshot's own live-token protocols, adjusted by seven-day growth and by how long the protocol has run with no token. It writes a static dashboard, board.json and dossier.json — no network, fully deterministic.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The dashboard renders from `out/data.js`, which the program writes from the same board as `out/board.json`, so the page and the board can never disagree.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
