# Falabella product flow notes

This note captures the product creation/publication requirements learned from the
Manta Raya test product (`ZENTOO-PRODUCT`) so future product screens can enforce
them before sending feeds.

## Core API flow

For product creation and publication use these Falabella actions:

- `GetProducts`: list/read products and current `ContentScore`, `QCStatus`,
  `BusinessUnits`, stock, images and `isPublished`.
- `GetContentScore`: fetch category-specific content rules before creating or
  updating a product.
- `ProductCreate`: create the product. It returns a feed/request id.
- `ProductUpdate`: update title, description, category attributes, business unit
  status/price and other content fields. It returns a feed/request id.
- `Image`: upload/associate product image URLs. It returns a feed/request id.
- `UpdateStock`: update sellable stock. Its feed id is returned under
  `SuccessResponse.Body.Stocks.feed`, not `Head.RequestId`.
- `FeedStatus` / `FeedList`: poll feeds until `Finished` and inspect
  `FailedRecords`/errors.

All product mutations are asynchronous. A successful HTTP response only means the
feed was accepted. The product is not ready until the feed finishes with
`FailedRecords=0`.

## Publication meaning

Do not treat `BusinessUnit.Status=active` as published.

The product is truly published/sellable only when all relevant checks are ready:

- `BusinessUnit.Status=active`
- stock is greater than `0`
- images are valid and attached
- `QCStatus` is approved/passed by Falabella
- `BusinessUnit.IsPublished` is `1`

During review, products can show `active` and still have `IsPublished=0`.

## Content score requirements

Always call `GetContentScore` with:

- `CategoryId`: the selected `PrimaryCategory` id
- `Operator`: marketplace/country operator, e.g. `fape` for Peru
- `GetRulesOnly=1`

For Manta Raya category `2917` (`Organizadores dormitorio | Living`) with
operator `fape`, Falabella returned these content-score rules:

- `title`: must be between 20 and 100 characters.
- `description`: must have at least 50 words.
- `attributes.unidades`: required.
- `attributes.ancho`: required.
- `attributes.alto`: required.
- `attributes.profundidad`: required.
- `attributes.material`: required.
- `attributes.capacidad`: required.
- `images`: at least 3 images.
- `title`: more than 120 characters is penalized.

These rules are category-specific. Do not hardcode them globally except as
fallback UI guidance.

## UI validation requirements

Future product creation/edit screens should:

- Fetch category rules via `GetContentScore` after category/operator selection.
- Show a content-score checklist before `ProductCreate`.
- Block or strongly warn on missing required content-score fields.
- Validate title length against the category rule.
- Validate description word count against the category rule.
- Require image count from the category rule, not a fixed app default.
- Require category attributes dynamically, including fields like `Capacidad`.
- Display current `ContentScore`, `QCStatus`, `IsPublished`, stock, image count
  and latest feeds.
- Distinguish feed acceptance from feed completion.
- Surface feed errors from `FeedStatus` and `FeedList`.

## Lessons from `ZENTOO-PRODUCT`

The product was created and then updated to:

- `BusinessUnit.Status=active`
- stock `1`
- 3+ images attached

However, Seller Center still showed the product as not sellable while content/QC
was unresolved. The checklist showed failures for:

- `title`: too short (`Zentoo product`, 14 characters)
- `description`: fewer than 50 words
- `capacidad`: missing

This means the product UI should not rely only on the generic validations in
`ProductCreate`. It must use `GetContentScore` and collect enough category
content before sending creation/publication feeds.

