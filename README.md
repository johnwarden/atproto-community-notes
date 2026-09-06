# ATProto Community Notes

An reference implementation of a **community notes** service for the [AT Protocol](https://atproto.com): the submission service and app view (proposals, voting, scoring, labels, and feed-generator integration over XRPC).

Background and protocol spec live in [**Open Community Notes**](https://github.com/johnwarden/open-community-notes).

## Repository

| Path | Role |
|------|------|
| `packages/notes` | Core library, lexicon, XRPC server |
| `services/notes` | Production service entrypoint |
| `packages/dev-env`, `packages/dev-infra` | Local dev orchestration and containers |

## Quick start

Prerequisites: [Devbox](https://www.jetify.com/devbox), Docker (Postgres/Redis for tests and dev).

One-time: `devbox install`.

Enter the environment. Devbox’s [`init_hook`](./devbox.json) runs `pnpm install --frozen-lockfile` when the shell loads:

- **`devbox shell`**, or  
- **direnv**: run `direnv allow` once in this directory; afterward, `cd` into the repo loads the same environment ([`.envrc`](./.envrc)).

Then:

```bash
just codegen
just build
just start
```

## Local dev server

The local stack follows the multi-service **test network** pattern from the AT Protocol tooling package [`@atproto/dev-env`](https://www.npmjs.com/package/@atproto/dev-env) (PLC, PDS, App View, Ozone, introspection, and supporting processes). This repo layers on **Community Notes** (public XRPC plus the internal scoring API) and a **test labeler** used for label integration during development.

| Command | What it does |
|--------|----------------|
| `just start` | Brings up Docker (Postgres/Redis) and the full stack; waits until services are ready. |
| `just stop` | Shuts everything down cleanly. |
| `just status` | Prints service URLs and mock-setup state. |

Use `just health` to probe endpoints. Default ports, credentials, and the rest of the workflow are in [`AGENTS.md`](./AGENTS.md).

## Authentication

The Community Notes XRPC API accepts these client auth modes:

| Mode | `Authorization` | Extra headers | How it is verified |
|------|-----------------|---------------|--------------------|
| Password session | `Bearer <accessJwt>` | — | PDS `com.atproto.server.getSession` (`Bearer`, not DPoP) |
| OAuth DPoP (JWKS published) | `DPoP <access_token>` | `DPoP: <proof JWT>` | RFC 9449 DPoP proof, then issuer JWKS + `cnf.jkt` |
| Service-auth (Bluesky / empty JWKS) | `Bearer <serviceJwt>` | — | AT Protocol service JWT: `aud` = notes service DID, `lxm` = this XRPC method, `exp`, sig via user DID signing key |
| getProposals omit (interim) | — | — | Soft-anon 200 (note bodies). Not allowed for `propose` / `vote`. |

`getProposals` and feed skeletons are anonymous when the header is omitted. A present but invalid header (including empty `Bearer` or DPoP with empty issuer JWKS) is **401**. `propose` and `vote` always require a valid token.

**Empty JWKS / Bluesky OAuth:** this service does **not** forward the client's notes-bound DPoP proof to PDS `getSession` (`htu` would not match). Clients mint `com.atproto.server.getServiceAuth` at the user's PDS (DPoP proof bound to that PDS URL) with `aud` = `feedGeneratorDid` from `getConfig` (bare DID or `did#serviceId`) and `lxm` = the notes method NSID, then send that JWT as `Bearer`.

**Soft-gate for signed-in note bodies:** use **service-auth** (`Bearer` service JWT) so `getProposals` can attach viewer context. Until the bluenotes client does that, omit `Authorization` on `getProposals` only (soft-anon bodies). Do not ship `propose` / `vote` without service-auth, password Bearer, or DPoP+JWKS.

Behind a reverse proxy, set `PUBLIC_URL` to the public base URL clients call (for example `https://api.bluenotes.social`). DPoP `htu` checks use this value, not `PDS_URL` or the process listen address. Unset locally — the incoming request host is used.

Implementation: `AuthService.verifyAuthHeader(req)` in `packages/notes/src/auth.ts`.

## License

MIT. See [`LICENSE`](./LICENSE).
