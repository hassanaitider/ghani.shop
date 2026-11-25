# Ghani Shop — SolarGlow landing page + admin

Zero-dependency Node.js app (Node 18+).

```
node server.js            # or: npm start
```

- Home (country picker): http://localhost:3000
- One page per country: `/ma`, `/ci`, `/ga`, `/ml`, `/bf`, `/sn` (the URL slug is editable in the admin)
- Admin: http://localhost:3000/admin — tabs: Dashboard, Orders (grouped by country), Countries & products

**Admin password:** set `ADMIN_PASSWORD` (and optionally `PORT`) as environment variables. If not set, a random password is generated on first run and saved in `DATA_DIR/admin-password.txt`.

**Storage:** everything (countries, per-country catalogs, orders) is in `DATA_DIR/store.json`. `DATA_DIR` defaults to `./data`; on Render it points at the persistent disk (see `render.yaml`). On first start with no countries, Morocco, Côte d'Ivoire, Gabon, Mali, Burkina Faso and Senegal are seeded.

`npm run build` checks that every script parses and that the shared pricing model works (there is no TypeScript or bundler).

## Where to edit

| What | File |
|---|---|
| Prices (EUR base), bundles, cross-sell items, countries, currencies | `public/shared.js` |
| All texts (FR / EN, store + admin) | `public/i18n.js` |
| Real GIFs / videos instead of the built-in animated scenes | `MEDIA` at the top of `public/app.js` (put files in `public/media/`) |
| Sample customer reviews | `public/index.html` (`#reviews`) + `rev.*` keys in `public/i18n.js` |

Exchange rates and stock are editable live from the admin dashboard. Orders are stored in `data/store.json`. Totals are always recomputed on the server from `shared.js`, so the browser cannot change prices.
