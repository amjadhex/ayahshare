-- Sign in with Apple (POST /api/auth/apple, src/routes/auth.ts; only the iOS app offers it).

-- The Apple user id (the identity token's `sub`, stable for this app's team). NULL for accounts that never used Apple.
-- An account made by Apple gets the placeholder google_sub 'apple:<users.id>' (like 'email:<users.id>', 0008), which no
-- Google subject (a number) can equal; Google with the same verified email later puts its subject there instead.
ALTER TABLE users ADD COLUMN apple_sub TEXT;
CREATE UNIQUE INDEX users_apple_sub ON users(apple_sub);
