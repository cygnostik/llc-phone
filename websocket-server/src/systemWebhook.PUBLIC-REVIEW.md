# Public review required

This project currently contains `systemWebhook.ts`, which should remain generic and environment-driven in the public version.

Before publishing, either:
- replace it with a generic webhook adapter driven entirely by environment variables, or
- remove it and the related imports/calls from the public release

Do not publish any local config-file fallback for webhook secrets.
