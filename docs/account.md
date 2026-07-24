# Account & data

Two endpoints cover the "your data, your call" side of a signed-in account on the hosted demo ([ADR-0019](adr/0019-hosted-demo-identity-and-auth.md)): exporting everything attached to it, and deleting everything attached to it. Both require authentication — neither exists in self-host mode (auth off), since the sentinel `default` user has no account to export or delete.

## `GET /me/export`

Streams a full JSON dump of the signed-in user's data: profile, linked sign-in identities, lookup runs (including saved searches), collections, wishlists, binders, favorite sets/species, and swipe history. Rate-limited to 5 requests per 5 minutes per user. See [#448](https://github.com/mgzwarrior/mgz-pkmn/issues/448).

## `DELETE /me`

Permanently deletes the signed-in user's account. **This cannot be undone and there is no admin recovery path.** One request removes:

- Lookup runs (saved searches)
- Collections and everything filed in them
- Wishlists and everything filed in them
- Binders
- Favorite sets and favorite species
- Swipe history
- Every linked sign-in identity (GitHub, Google, Discord, Apple, magic-link)

The session cookie is cleared in the same request, so the browser stops acting as the account immediately. Signing back in through a provider that used to be linked to this account mints a brand-new, empty account — the old data is gone, not recovered.

Returns `204` on success, `401` if you're not signed in, and `404` if auth is off (self-host). See [#950](https://github.com/mgzwarrior/mgz-pkmn/issues/950).
