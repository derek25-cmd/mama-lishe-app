import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, queryOne, closePool } from "../src/lib/db.js";
import { readSheetRows } from "./lib/xlsx.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "..", "seed-data");

// Fixed anchor date so re-running the seed on a different day still hits the
// same ref.ingredient_units unique key (ingredient_id, market_id,
// unit_name_sw, valid_from) — that's what makes this script idempotent.
const SEED_EFFECTIVE_DATE = "2026-01-01";

interface RecipeRow {
  recipe_name_sw: string;
  recipe_name_en: string;
  ingredient_name_sw: string;
  qty_per_10_plates_g: number;
  is_optional: string;
}
interface IngredientRow {
  name_sw: string;
  name_en: string;
  category: string;
  canonical_unit: string;
}
interface UnitRow {
  ingredient_name_sw: string;
  unit_name_sw: string;
  market: string;
  grams_per_unit: number;
  field_verified: string;
}

async function seedRegion(): Promise<string> {
  const existing = await queryOne<{ id: string }>("select id from ref.regions where code = $1", ["DSM"]);
  if (existing) return existing.id;

  const inserted = await queryOne<{ id: string }>(
    "insert into ref.regions (name, code) values ($1, $2) returning id",
    ["Dar es Salaam", "DSM"],
  );
  if (!inserted) throw new Error("failed to insert ref.regions row");
  return inserted.id;
}

async function seedMarkets(regionId: string): Promise<Map<string, string>> {
  const names = ["Kariakoo", "Buguruni", "Tandale"];
  const map = new Map<string, string>();

  for (const name of names) {
    const existing = await queryOne<{ id: string }>(
      "select id from ref.markets where name = $1 and region_id = $2",
      [name, regionId],
    );
    if (existing) {
      map.set(name, existing.id);
      continue;
    }
    const inserted = await queryOne<{ id: string }>(
      "insert into ref.markets (name, region_id) values ($1, $2) returning id",
      [name, regionId],
    );
    if (!inserted) throw new Error(`failed to insert ref.markets row for "${name}"`);
    map.set(name, inserted.id);
  }
  return map;
}

async function seedIngredients(): Promise<Map<string, string>> {
  const rows = await readSheetRows<IngredientRow>(join(SEED_DIR, "ingredients.xlsx"), "ingredients");
  const map = new Map<string, string>();

  for (const row of rows) {
    if (!row.name_sw || !row.name_en || !row.category || !row.canonical_unit) {
      throw new Error(`malformed ingredients.xlsx row: ${JSON.stringify(row)}`);
    }
    if (row.canonical_unit !== "g" && row.canonical_unit !== "ml") {
      throw new Error(`ingredients.xlsx row "${row.name_sw}" has invalid canonical_unit "${row.canonical_unit}" (must be g or ml)`);
    }

    const existing = await queryOne<{ id: string }>("select id from ref.ingredients where name_sw = $1", [row.name_sw]);

    if (existing) {
      await query("update ref.ingredients set name_en = $1, category = $2, canonical_unit = $3 where id = $4", [
        row.name_en,
        row.category,
        row.canonical_unit,
        existing.id,
      ]);
      map.set(row.name_sw, existing.id);
      continue;
    }

    const inserted = await queryOne<{ id: string }>(
      "insert into ref.ingredients (name_sw, name_en, category, canonical_unit) values ($1, $2, $3, $4) returning id",
      [row.name_sw, row.name_en, row.category, row.canonical_unit],
    );
    if (!inserted) throw new Error(`failed to insert ref.ingredients row for "${row.name_sw}"`);
    map.set(row.name_sw, inserted.id);
  }
  return map;
}

// Note: every row in ingredient_units.xlsx specifies a market (no
// national-default rows in this dataset), so the ON CONFLICT target below
// never has to contend with NULL market_id — Postgres treats distinct NULLs
// as non-conflicting, which would silently break idempotency for those rows.
async function seedIngredientUnits(ingredientIds: Map<string, string>, marketIds: Map<string, string>): Promise<number> {
  const rows = await readSheetRows<UnitRow>(join(SEED_DIR, "ingredient_units.xlsx"), "ingredient_units");
  let count = 0;

  for (const row of rows) {
    if (!row.ingredient_name_sw || !row.unit_name_sw || !row.market || !row.grams_per_unit) {
      throw new Error(`malformed ingredient_units.xlsx row: ${JSON.stringify(row)}`);
    }
    const ingredientId = ingredientIds.get(row.ingredient_name_sw);
    if (!ingredientId) throw new Error(`ingredient_units references unknown ingredient "${row.ingredient_name_sw}"`);
    const marketId = marketIds.get(row.market);
    if (!marketId) throw new Error(`ingredient_units references unknown market "${row.market}"`);
    const source = row.field_verified === "YES" ? "field" : "ops";

    await query(
      `insert into ref.ingredient_units (ingredient_id, market_id, unit_name_sw, grams_per_unit, valid_from, source)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (ingredient_id, market_id, unit_name_sw, valid_from)
       do update set grams_per_unit = excluded.grams_per_unit, source = excluded.source`,
      [ingredientId, marketId, row.unit_name_sw, row.grams_per_unit, SEED_EFFECTIVE_DATE, source],
    );
    count++;
  }
  return count;
}

async function seedBaseRecipes(ingredientIds: Map<string, string>): Promise<{ recipes: number; recipeIngredients: number }> {
  const rows = await readSheetRows<RecipeRow>(join(SEED_DIR, "base_recipes.xlsx"), "base_recipes");
  const recipeIds = new Map<string, string>();
  let recipeIngredientCount = 0;

  for (const row of rows) {
    if (!row.recipe_name_sw || !row.recipe_name_en || !row.ingredient_name_sw || !row.qty_per_10_plates_g) {
      throw new Error(`malformed base_recipes.xlsx row: ${JSON.stringify(row)}`);
    }

    let recipeId = recipeIds.get(row.recipe_name_sw);
    if (!recipeId) {
      const existing = await queryOne<{ id: string }>("select id from ref.base_recipes where name_sw = $1", [
        row.recipe_name_sw,
      ]);

      if (existing) {
        recipeId = existing.id;
      } else {
        const inserted = await queryOne<{ id: string }>(
          "insert into ref.base_recipes (name_sw, name_en, base_plates) values ($1, $2, 10) returning id",
          [row.recipe_name_sw, row.recipe_name_en],
        );
        if (!inserted) throw new Error(`failed to insert ref.base_recipes row for "${row.recipe_name_sw}"`);
        recipeId = inserted.id;
      }
      recipeIds.set(row.recipe_name_sw, recipeId);
    }

    const ingredientId = ingredientIds.get(row.ingredient_name_sw);
    if (!ingredientId) throw new Error(`base_recipes references unknown ingredient "${row.ingredient_name_sw}"`);

    await query(
      `insert into ref.base_recipe_ingredients (recipe_id, ingredient_id, qty_per_base, is_optional)
       values ($1, $2, $3, $4)
       on conflict (recipe_id, ingredient_id)
       do update set qty_per_base = excluded.qty_per_base, is_optional = excluded.is_optional`,
      [recipeId, ingredientId, row.qty_per_10_plates_g, row.is_optional === "TRUE"],
    );
    recipeIngredientCount++;
  }

  return { recipes: recipeIds.size, recipeIngredients: recipeIngredientCount };
}

async function printSpotChecks(): Promise<void> {
  console.log("\n--- spot checks ---");

  const pilau = await query(
    `select r.name_sw as recipe, i.name_sw as ingredient, ri.qty_per_base
     from ref.base_recipes r
     join ref.base_recipe_ingredients ri on ri.recipe_id = r.id
     join ref.ingredients i on i.id = ri.ingredient_id
     where r.name_sw = $1
     order by ri.qty_per_base desc`,
    ["Pilau ya nyama"],
  );
  console.log("1) Pilau ya nyama ingredients (qty per 10 plates, g):");
  console.table(pilau);

  const riceUnits = await query(
    `select m.name as market, u.unit_name_sw, u.grams_per_unit
     from ref.ingredient_units u
     join ref.ingredients i on i.id = u.ingredient_id
     join ref.markets m on m.id = u.market_id
     where i.name_sw = $1`,
    ["Mchele"],
  );
  console.log("2) Mchele (rice) informal units per market:");
  console.table(riceUnits);

  const counts = await queryOne<{ markets: string }>("select count(*) as markets from ref.markets");
  console.log("3) total markets seeded:", counts?.markets);
}

async function main(): Promise<void> {
  console.log("Faida seed loader — starting");

  const regionId = await seedRegion();
  console.log(`region: Dar es Salaam (${regionId})`);

  const marketIds = await seedMarkets(regionId);
  console.log(`markets: ${[...marketIds.keys()].join(", ")}`);

  const ingredientIds = await seedIngredients();
  console.log(`ingredients: ${ingredientIds.size}`);

  const unitCount = await seedIngredientUnits(ingredientIds, marketIds);
  console.log(`ingredient_units: ${unitCount}`);

  const { recipes, recipeIngredients } = await seedBaseRecipes(ingredientIds);
  console.log(`base_recipes: ${recipes}, base_recipe_ingredients: ${recipeIngredients}`);

  await printSpotChecks();
  await closePool();
  console.log("\nFaida seed loader — done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
