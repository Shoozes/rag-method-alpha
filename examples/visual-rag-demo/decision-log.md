# Decision log

## D-014 — Local durable storage

The recorded storage decision is to keep the demonstration collection in
bounded local files with deterministic identities. A required cloud database
or hosted vector dependency is prohibited for the default example.

This decision supports the local-first promise in [[project-charter]].
