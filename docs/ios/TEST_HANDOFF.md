# Re:Memory iOS Test Handoff

- Open: `ios/ReMemory.xcodeproj`
- Scheme: `ReMemory`
- Environment: `REMEMORY_API_BASE_URL`, `REMEMORY_OAUTH_TOKEN`, `REMEMORY_SUPABASE_URL` (upload only)
- Run: add the environment values to the Scheme's Run arguments, select an iPhone Simulator, then Run.
- Verify: Memories list, Memory detail, Confirmation sheet, Recall search.
- Known incomplete: signed-image expiry triggers a manual refresh; upload processing polling is not automated.
