# Monetization: game passes, developer products, badges

Read when you need to create or change game passes, developer products or badges, or their localized names, descriptions and icons.

Prices, sale state and badge creation are outward-facing, and badge creation spends Robux. Show the dry-run plan with the price or cost in it, and send only after a clear yes. Granting the purchase in game (`MarketplaceService.ProcessReceipt`) is engine code, not Open Cloud.

Paths below are relative to `https://apis.roblox.com`; `<u>` = universe ID. All endpoints are official.

## Game passes (beta)
```bash
oc.ts request GET  /game-passes/v1/universes/<u>/game-passes/creator                 # list, with configuration
oc.ts request GET  /game-passes/v1/universes/<u>/game-passes/<passId>/creator
oc.ts request POST /game-passes/v1/universes/<u>/game-passes \
  --form name="Extra Slots" --form description="Two more inventory slots" \
  --form isForSale=true --form price=99 --form-file imageFile=icons/slots.png
oc.ts request PATCH /game-passes/v1/universes/<u>/game-passes/<passId> --form price=79       # multipart; `file` is an alias of imageFile
```
- **Fields:** `name`, `description`, `imageFile`, `isForSale`, `price`, `isRegionalPricingEnabled`, `isManagedPricingEnabled`.
- **Limits:** writes 5/s, reads 10/s.
- **Scopes:** `game-pass:read`, `game-pass:write`.

## Developer products (beta)
```bash
oc.ts request GET  /developer-products/v2/universes/<u>/developer-products/creator
oc.ts request POST /developer-products/v2/universes/<u>/developer-products \
  --form name="100 Gems" --form description="..." --form isForSale=true --form price=49 --form-file imageFile=icon.png
oc.ts request PATCH /developer-products/v2/universes/<u>/developer-products/<productId> --form isForSale=false
oc.ts request GET  /developer-products/v2/universes/<u>/developer-products/<productId>/creator
```
- **Fields:** the same as game passes. Don't combine `isRegionalPricingEnabled` with `isManagedPricingEnabled` (official).
- **Limits:** writes 3/s, reads 10/s.
- **Scopes:** `developer-product:read`, `developer-product:write`.

## Badges (experimental, `legacy-badges`)
```bash
oc.ts request POST /legacy-badges/v1/universes/<u>/badges \
  --form name="First Win" --form description="Won your first round" \
  --form paymentSourceType=1 --form expectedCost=<cost> --form isActive=true --form-file files=badge_icon.png
oc.ts request PATCH /legacy-badges/v1/badges/<badgeId> --json '{"name": "...", "description": "...", "enabled": true}'
```

**Creating a badge charges the selected payment source (official):**
- `paymentSourceType` is 1 or 2: user funds or group funds, in the spec's order (verify).
- `expectedCost` must match the current cost. Ask the user for the cost they see on Creator Hub before sending.
- The icon (`files`) is optional; exactly one file when given.

**Other badge endpoints:**
- Icon replacement: `POST /legacy-publish/v1/badges/<badgeId>/icon` (multipart; field name not in the spec, verify).
- Scopes: `legacy-universe.badge:manage-and-spend-robux` (create), `legacy-universe.badge:write`/`manage-and-spend-robux` (update), `legacy-badge:manage` (icon, localization).

## Localized names, descriptions, icons (experimental)
Under `/legacy-game-internationalization/v1/`:

| Item | Endpoints |
|---|---|
| Game passes | `game-passes/<id>/name-description`, `.../name/language-codes/<lang>`, `.../description/language-codes/<lang>`, `.../icons/language-codes/<lang>` |
| Developer products | `developer-products/<id>/...` (same shape) |
| Badges | `badges/<id>/...` (same shape) |

Read each endpoint page before the first call; the bodies are not documented here.

## Official links
- Game passes reference: https://create.roblox.com/docs/cloud/reference/features/game-passes
- Developer products reference: https://create.roblox.com/docs/cloud/reference/features/developer-products
- Badges reference: https://create.roblox.com/docs/cloud/reference/features/badges
- Monetization overview: https://create.roblox.com/docs/production/monetization
