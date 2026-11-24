# Ghani Shop — SolarGlow landing page + admin

Zero-dependency Node.js app (Node 18+).

```
node server.js            # or: npm start
```

- Store: http://localhost:3000
- Admin: http://localhost:3000/admin

**Admin password:** set `ADMIN_PASSWORD` (and optionally `PORT`) as environment variables. If not set, a random password is generated on first run and saved in `data/admin-password.txt`.

## Where to edit

| What | File |
|---|---|
| Prices (EUR base), bundles, cross-sell items, countries, currencies | `public/shared.js` |
| All texts (FR / EN, store + admin) | `public/i18n.js` |
| Real GIFs / videos instead of the built-in animated scenes | `MEDIA` at the top of `public/app.js` (put files in `public/media/`) |
| Sample customer reviews | `public/index.html` (`#reviews`) + `rev.*` keys in `public/i18n.js` |

Exchange rates and stock are editable live from the admin dashboard. Orders are stored in `data/store.json`. Totals are always recomputed on the server from `shared.js`, so the browser cannot change prices.
