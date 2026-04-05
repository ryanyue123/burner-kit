# burner-kit

Browser extension + Cloudflare Workers backend for generating and storing burner credentials.

## Dev setup

```bash
pnpm install
pnpm --filter worker db:migrate:local
pnpm dev
```

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design and implementation notes.
