# AC-09 rollback check

The AC-09 procedure, run on win-main on 2026-11-23 between 21:39 and 21:44 UTC through
`scripts/deploy/check-rollback.sh` at `d7ba4c8`. `transcript.txt` is the whole run as printed.

1. `scripts/deploy/deploy.sh 0.2.0`, then `scripts/deploy/deploy.sh 0.3.0-feat-asset-studio-mobile.3`, so
   `rollback.sh` returns to v0.2.0.
2. `check-rollback.sh 1-prerelease` recorded 100 jobs, image and database schema 2, a push key and 2 push
   endpoints.
3. `scripts/deploy/rollback.sh` rolled back to 0.2.0, and `check-rollback.sh 2-rolled-back --against
   1-prerelease` found every recorded job, schema 2 and 2, and both endpoints still in `push.json`. v0.2.0 has
   no push key route, so the key is compared only where both records have one.
4. `scripts/deploy/deploy.sh 0.3.0-feat-asset-studio-mobile.3` again, and `check-rollback.sh 3-rolled-forward
   --against 1-prerelease` found every job, schema 2 and 2, the same push key and both endpoints.

The output shows counts and the first 12 hex characters of SHA-256 digests. The endpoints are capability
URLs, and this repository is public.
