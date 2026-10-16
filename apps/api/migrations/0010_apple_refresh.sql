-- Sign in with Apple token revocation (App Store guideline 5.1.1(v); src/lib/apple.ts, src/routes/auth.ts).

-- The refresh token Apple gives for the app's one-time authorization code (POST /api/auth/apple { authorizationCode }),
-- kept only to revoke it (POST https://appleid.apple.com/auth/revoke) when the account is deleted, which ends the app's
-- Sign in with Apple link. 'v1:' + base64(IV ‖ AES-GCM ciphertext), with a key derived from the AUTH_CODE_SECRET secret
-- and the user id as additional data; the bare token when that secret is not set. NULL: no token (signed in before
-- build 2 of the iOS app, the exchange failed, or never used Apple).
ALTER TABLE users ADD COLUMN apple_refresh TEXT;
