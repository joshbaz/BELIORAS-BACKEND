# Belioras Server — Documentation Series

A numbered series, in reading order, mirroring the client's `docs/`
convention. Each file documents the step it is named for; later documents
assume the earlier ones.

| # | Document | Covers |
| --- | --- | --- |
| [00](00-code-conventions.md) | Code Conventions | Rules every file in this repo follows |
| [01](01-dependencies.md) | Dependencies | The stack, and why each piece |
| [02](02-folder-structure.md) | Folder Structure | Where every file lives |
| [03](03-setting-up.md) | Setting Up | One-time bootstrap, step by step |
| [04](04-http-api.md) | HTTP API | `/api/v1`, envelopes, error contract, versioning |
| [05](05-auth.md) | Auth | Realms, JWTs, refresh rotation, cookies |
| [06](06-sockets.md) | Sockets | Socket.IO setup, auth, events, future broadcasts |
| [07](07-client-contract.md) | Client Contract | The exact contract the Belioras client expects |

Everything in this folder describes the server as it stands at the `v1`
setup commit. When a piece changes, edit its document in the same change.