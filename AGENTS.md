# Starter development rules

- Use pnpm from the workspace root. Node 24 LTS (>=24.22.0, <25) and pnpm 12.14.0 are the baseline.
- Keep Web independently runnable: no API runtime or database required to render pages.
- Route pages and page shells are server components. Extract small client islands for interaction.
- Use `AppPageContainer` once per page and reuse `src/components/ui` before adding primitives.
- UI text and content metadata belong in `apps/web/src/i18n/messages.ts`; maintain en/zh shape parity. Author-maintained article bodies belong in `apps/web/content/{locale}/*.mdx`.
- API endpoints use OpenAPIHono, Zod validation, and `{ ok, error: { code, message } }` errors.
- Shared transport contracts belong in `packages/shared`; Web never imports backend implementation.
- D1 is optional. Missing bindings must yield a clear 503 for data endpoints only.
- Use local migrations for verification; never run remote migrations or deploy without explicit authorization.
- Secrets go in `.dev.vars` / Cloudflare secrets. Never copy credentials from the source project.
- Default scripts never kill occupied ports or connect to remote resources.
- Verify with `pnpm check`. Use `pnpm check:web` for a frontend-only change.
- Dependency changes also require `pnpm audit:check`; keep React/RSC, Cloudflare and lint tool groups compatible. Review `docs/dependencies.md` before changing overrides or patches.
- Runtime, routing, config or dependency changes require `pnpm test:smoke`; interaction changes require `pnpm test:e2e`. Use temporary local D1 state and only stop processes created by the test runner.
- Do not add tests for trivial wiring or generated examples. Verify real routes and bindings when practical.
- Binding changes require `pnpm --filter @starter/api cf-typegen` and the generated declaration.
- Deployment config verification intentionally rejects starter placeholders; it is separate from local checks.
- Clean up verification servers and report the real environment used. Preserve explicitly requested preview/development services for the user.
