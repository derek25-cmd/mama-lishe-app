-- Up Migration

-- DOC 05 §8 — indexing strategy

-- POS hot paths
create index sales_vendor_day on pos.sales (vendor_id, sold_at desc);
create index sales_deni_open on pos.sales (vendor_id, deni_customer_id)
  where payment_method = 'deni' and voided = false; -- partial
create index expenses_vendor_day on pos.expenses (vendor_id, spent_at desc);

-- Costing
create index plans_vendor_date on costing.cook_plans (vendor_id, plan_date desc);

-- Price pipeline
create index subs_agg on price.submissions
  (market_id, ingredient_id, submitted_at) where status = 'pending';
create index prices_lookup on price.market_prices
  (market_id, week_start desc) include (ingredient_id, price_per_kg_tzs, confidence);

-- Search fallback (pre-OpenSearch/Meilisearch)
create index recipes_trgm on costing.vendor_recipes using gin (name_sw gin_trgm_ops);

-- Scale plan: monthly partitions on pos.sales beyond ~5M rows; BRIN on sold_at
-- (deferred until partitioning is warranted — tracked, not implemented at pilot scale)

-- Down Migration

drop index if exists pos.sales_vendor_day;
drop index if exists pos.sales_deni_open;
drop index if exists pos.expenses_vendor_day;
drop index if exists costing.plans_vendor_date;
drop index if exists price.subs_agg;
drop index if exists price.prices_lookup;
drop index if exists costing.recipes_trgm;
