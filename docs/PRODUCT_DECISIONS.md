# Re:Memory Product Decisions

## Delete and Forget

Re:Memory uses one explicit action: **完全に削除**. A Memory deletion removes
its database graph and original/derivative media. Account deletion removes all
user rows, media objects, and the Auth account. The UI never calls a soft hide
operation “delete”.

## People and relationships

People/relationship questions are a later enrichment layer, not a prerequisite
for the core photo-to-Memory flow. The product may ask only when evidence is
strong, importance is medium/high, and the user opted into people context.
Unknown identity must remain unknown.

## Confirmation entry point

Confirmation is entered from the Home invitation and pending-count badge. It is
not a permanent bottom-navigation destination because unanswered gaps should
not dominate the everyday recall flow. Deferred questions return after their
due time.

## Search learning

Search learning is opt-in and explicit. Only “役に立った” or “違った” feedback
is stored. It reranks the same normalized query and is deleted when the setting
is disabled. Passive browsing is never treated as approval.
