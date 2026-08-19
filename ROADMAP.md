# Roadmap to v1.0

> Starskiff boots real Cosmos SDK nodes as small, deterministic test dependencies across local and CI environments.

## Runtime and lifecycle

- [x] Serialize instance timeout cleanup before allowing another start
- [x] Hide local-binary and Docker execution behind one cancellable internal adapter
- [x] Apply runtime options to every Cosmos genesis and start command
- [x] Reject node exits before readiness regardless of exit code
- [ ] Make Hermes setup commands asynchronous, cancellable, and bounded by the instance timeout
- [ ] Align Hermes telemetry readiness with its exposed endpoint
- [ ] Fail early when required TOML keys drift from supported chain layouts
- [x] Validate `extraValidators` as a finite non-negative integer

## Public interface

- [x] Replace `Instance.define` parameter and option guessing with an explicit v1 contract
- [x] Encode the `image` or `binary` choice in types as well as runtime validation
- [x] Centralize Cosmos EVM chain ID handling while keeping wrapper defaults explicit
- [x] Keep generic runtime options on custom-chain builders and out of high-level Instance parameters
- [ ] Expose the Hermes connection and channel mapping created during setup
- [ ] Stabilize the public API and document the v1 compatibility policy

## Images and artifacts

- [x] Publish the multi-arch evmd image and pin its manifest digest
- [x] Use official images for Gaia, XPLA, MANTRA, and XRPL EVM
- [x] Upgrade evmd to cosmos/evm v0.7.1, publish it, and pin the new manifest digest
- [ ] Replace the floating simd minor tag with an explicit artifact policy
- [ ] Add a default marood image if upstream publishes a distributable image
- [x] Remove or redefine the unused `binaries/latest` publishing lane

## Test integrations

- [x] Add `starskiff.config.ts` for declarative chain and relayer setup
- [ ] Add `starskiff/vitest` for automatic suite setup and teardown
- [ ] Add `starskiff/playwright` for automatic worker-scoped instances
- [ ] Add a `starskiff/setup-binaries` GitHub Action for host-binary provisioning
- [ ] Evaluate a shared Docker network for container-native chains and relayers
- [ ] Add network instances on demand when a maintainable upstream artifact exists

## Distribution and release

- [x] Gate publishing on Node 22 and 24 checks, docs, integration, and feature tests
- [x] Verify downloaded Hermes assets with a pinned SHA-256 checksum
- [ ] Pin third-party GitHub Actions to reviewed commit SHAs
- [x] Add packed-package acceptance tests for the ESM export and type surface
- [ ] Upgrade the docs stack and clear production dependency advisories
- [ ] Configure the documentation base URL and sitemap generation
- [ ] Publish v1.0 after the public API and artifact policy are stable
