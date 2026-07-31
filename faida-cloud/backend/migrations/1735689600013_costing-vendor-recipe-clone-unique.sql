-- Up Migration

-- DOC 05 §4's costing.vendor_recipes has no unique constraint on
-- (vendor_id, base_recipe_id), but Phase 3's "clone-on-first-use" repository
-- boundary (loadVendorRecipes) needs one: the first time a vendor references
-- a base recipe by name, the repository clones it into their own
-- vendor_recipes/vendor_recipe_ingredients rows via
-- `insert ... on conflict (vendor_id, base_recipe_id) do nothing`, then reads
-- back whichever row won if two concurrent requests raced. Without this
-- constraint that race would silently create duplicate clones. Scoped as a
-- partial unique index (base_recipe_id is not null) so it does not restrict
-- fully custom vendor recipes, which have no base and are never cloned.
create unique index vendor_recipes_vendor_base_recipe_key
  on costing.vendor_recipes (vendor_id, base_recipe_id)
  where base_recipe_id is not null;

-- Down Migration

drop index if exists costing.vendor_recipes_vendor_base_recipe_key;
