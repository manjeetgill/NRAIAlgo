# Owner-controlled account access

Login includes **Forgot password?** and **Create new account**. This is an
owner-assisted flow, not public signup or automated email delivery. The owner
must verify the recipient's identity and deliver the code privately to their
verified address/channel. Do not paste codes into shared chat, tickets or logs.

## Local development

Start the API normally so migration 10 runs. From the repository root:

```sh
npm run access-code --workspace backend/nodejs -- --email person@example.com --purpose invite
npm run access-code --workspace backend/nodejs -- --email person@example.com --purpose reset
```

Invitations require a new email; reset codes require an existing account.
The recipient opens `/login`, chooses the matching action, and enters the exact
email, code and a new 12–256 character password. Each new user has an independent
workspace, not access to the owner's accounts. No email is automatically sent.

## Production

Deploy migration 10 before starting this release. Use a one-off administrative
container with the same image/network and verified database TLS as the migration
job. Supply `DATABASE_ADMIN_URL_FILE` and `DATABASE_CA_FILE`, then run:

```sh
node backend/nodejs/dist/issue-access-code.js --email person@example.com --purpose invite
```

For recovery use `--purpose reset`. Do not mount administrator credentials into
the long-running API or make code issuance a public endpoint. The same offline
command supports recovery for the app owner. Local codes do not work on staging.

## Protections and limits

- Cryptographically random 256-bit codes; only SHA-256 digests are stored.
- Codes are bound to email and purpose, single-use, and atomically consumed.
- Invites expire after 24 hours; recovery codes after 30 minutes. Issuing a new
  code invalidates the previous code for that email and purpose.
- Changing the password invalidates previously issued reset codes. Successful
  recovery revokes all existing app sessions and requires a fresh sign-in.
- Runtime can SELECT/DELETE codes, but cannot INSERT/UPDATE them. PostgreSQL
  administrators remain trusted and can override permissions.
- Redemption is IP/account rate-limited. Responses do not disclose account
  existence for invalid codes. Tokens are entered in a form, not URL parameters.
- Email automation and an owner-management UI are not part of this release.
  Existing per-process rate limits are not a distributed rate-limit service.
- Sensitive token tables are not granted to the pgAdmin read-only role.

Recovery reference: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
