# Ghani Shop — SolarGlow landing page + admin

Zero-dependency Node.js app (Node 18+).

```
node server.js            # or: npm start
```

- Home (country picker): http://localhost:3000
- One page per country with its own categories and products: `/kenya`, `/spain`, `/ma`… (the URL slug is editable in the admin)
- Product page: `/<country>/<product>` (title and primary image first, then the description; a color text field only appears on products with color options)
- Admin: http://localhost:3000/admin — tabs: Dashboard, Orders (grouped by country), Countries, Categories (pick a country first), Products (pick a country first, then one of its categories)
- Landing page builder (Admin → Products → edit): upload images/GIFs from your PC (JPG, PNG, WEBP, GIF, 8 MB each; stored in `DATA_DIR/uploads` on the persistent disk, no external URLs), size variants, color text input, quantity bundles with discounts, complementary products on the COD form, and free-form landing blocks (heading + text + image/GIF).
- On every start, any missing target country (Kenya … Romania) is inserted; existing countries, categories, products and orders are never overwritten.

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
