# Plan: Add a login endpoint with session handling

## Files
- src/auth/login.ts — login route handler
- src/auth/session.ts — session create/validate
- src/api/client.ts — typed API client
- src/utils/index.ts — barrel export for utils
- src/utils/helpers.ts — misc helpers
- src/api/v2/legacy.ts (optional) — legacy v2 shim
- src/components/Button.tsx (optional) — refactor shared button
- docs/login.md (optional) — login docs

## Steps
1. Scaffold auth module
2. Implement login endpoint
3. Add session create/validate
4. Wire typed API client
5. Merge utils/helpers into utils/index
6. Refactor shared Button component (optional)
7. Add legacy v2 shim (optional)
8. Write login docs (optional)

## Output
~2400 tokens
