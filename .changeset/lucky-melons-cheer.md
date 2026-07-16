---
"starskiff": minor
---

Run instances from official chain container images.

Chains that publish an image that tracks their live network are now
container-first: `Instance.xplad()` boots `ghcr.io/xpladev/xpla` with no Go
toolchain and nothing to install but Docker. The image is only where the node
comes from — the chain CLI still runs against a host-mounted home directory,
genesis is still patched host-side, and the node still runs as an attached child
process under starskiff's own lifecycle, so logs, events, ports and URL getters
are unchanged.

Every instance accepts an `image` parameter, and container-first instances take
a `binary` to opt back out:

```ts
Instance.xplad()                        // container (default)
Instance.xplad({ image: 'my/xpla:tag' }) // your image
Instance.xplad({ binary: 'xplad' })      // binary on PATH
Instance.evmd({ image: 'my/evmd:dev' })  // image for a binary-default instance
```

**Breaking for `xplad` users**: `Instance.xplad()` now requires Docker. Pass
`binary: 'xplad'` to keep the previous behaviour.
