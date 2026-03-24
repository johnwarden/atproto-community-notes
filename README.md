# ATProto Community Notes

An open implementation of **community notes** for the [AT Protocol](https://atproto.com) ecosystem: proposals, voting, scoring, labels, and feed-generator integration over XRPC.

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

## License

MIT. See [`LICENSE`](./LICENSE).
