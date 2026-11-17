# dsh-opencode-go-usage

OpenCode Go usage limits in the Harness status bar: 5-hour, weekly and monthly allowances with reset countdowns.

DSH bundle (DeepSeek Harness plugin). Host side in `index.js`, optional Web UI in `client.js` / `client.bundle.js`,
loaded through `cordis.patch.yml` (`dsh.bundle.patch` in package.json).

## Install

In DSH, open **Plugins** and install from a git source:

```
github:UberAemos40/dsh-opencode-go-usage
```

No build step is needed: the compiled client bundle is committed.
After installing, enable the bundle and refresh the page (a restart is needed if the host side changed).

## Requirements

- A DSH build with a Web client of the same generation (`@deepseek-ai/dsh-client-*` packages).
- Nothing else: no registry, no extra dependencies.

## Credentials

The quota numbers come from the OpenCode Go account configured in DSH. Set your own credentials after installing:
nothing is bundled with the plugin.
