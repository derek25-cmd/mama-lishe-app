import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db, closeDb } from "../src/lib/db.js";
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
  const existing = await db()
    .selectFrom("ref.regions")
    .select("id")
    .where("code", "=", "DSM")
    .executeTakeFirst();
  if (existing) return existing.id;

  const inserted = await db()
    .insertInto("ref.regions")
    .values({ name: "Dar es Salaam", code: "DSM" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function seedMarkets(regionId: string): Promise<Map<string, string>> {
  const names = ["Kariakoo", "Buguruni", "Tandale"];
  const map = new Map<string, string>();

  for (const name of names) {
    const existing = await db()
      .selectFrom("ref.markets")
      .select("id")
      .where("name", "=", name)
      .where("region_id", "=", regionId)
      .executeTakeFirst();
    if (existing) {
      map.set(name, existing.id);
      continue;
    }
    const inserted = await db()
      .insertInto("ref.markets")
      .values({ name, region_id: regionId })
      .returning("id")
      .executeTakeFirstOrThrow();
    map.set(name, inserted.id);
  }
  return map;
}

async function seedIngredients(): Promise<Map<string, string>> {
  const rows = await readSheetRows<IngredientRow>(join(SEED_DIR, "ingredients.xlsx"), "ingredients");
  const map = new Map<string, string>();

  for (const row of rows) {
    const canonicalUnit = row.canonical_unit as "g" | "ml";
    const existing = await db()
      .selectFrom("ref.ingredients")
      .select("id")
      .where("name_sw", "=", row.name_sw)
      .executeTakeFirst();

    if (existing) {
      await db()
        .updateTable("ref.ingredients")
        .set({ name_en: row.name_en, category: row.category, canonical_unit: canonicalUnit })
        .where("id", "=", existing.id)
        .execute();
      map.set(row.name_sw, existing.id);
      continue;
    }

    const inserted = await db()
      .insertInto("ref.ingredients")
      .values({ name_sw: row.name_sw, name_en: row.name_en, category: row.category, canonical_unit: canonicalUnit })
      .returning("id")
      .executeTakeFirstOrThrow();
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
    const ingredientId = ingredientIds.get(row.ingredient_name_sw);
    if (!ingredientId) throw new Error(`ingredient_units references unknown ingredient "${row.ingredient_name_sw}"`);
    const marketId = marketIds.get(row.market);
    if (!marketId) throw new Error(`ingredient_units references unknown market "${row.market}"`);
    const source = row.field_verified === "YES" ? "field" : "ops";

    await db()
      .insertInto("ref.ingredient_units")
      .values({
        ingredient_id: ingredientId,
        market_id: marketId,
        unit_name_sw: row.unit_name_sw,
        grams_per_unit: row.grams_per_unit,
        valid_from: SEED_EFFECTIVE_DATE,
        source,
      })
      .onConflict((oc) =>
        oc.columns(["ingredient_id", "market_id", "unit_name_sw", "valid_from"]).doUpdateSet({
          grams_per_unit: row.grams_per_unit,
          source,
        }),
      )
      .execute();
    count++;
  }
  return count;
}

async function seedBaseRecipes(ingredientIds: Map<string, string>): Promise<{ recipes: number; recipeIngredients: number }> {
  const rows = await readSheetRows<RecipeRow>(join(SEED_DIR, "base_recipes.xlsx"), "base_recipes");
  const recipeIds = new Map<string, string>();
  let recipeIngredientCount = 0;

  for (const row of rows) {
    let recipeId = recipeIds.get(row.recipe_name_sw);
    if (!recipeId) {
      const existing = await db()
        .selectFrom("ref.base_recipes")
        .select("id")
        .where("name_sw", "=", row.recipe_name_sw)
        .executeTakeFirst();

      if (existing) {
        recipeId = existing.id;
      } else {
        const inserted = await db()
          .insertInto("ref.base_recipes")
          .values({ name_sw: row.recipe_name_sw, name_en: row.recipe_name_en, base_plates: 10 })
          .returning("id")
          .executeTakeFirstOrThrow();
        recipeId = inserted.id;
      }
      recipeIds.set(row.recipe_name_sw, recipeId);
    }

    const ingredientId = ingredientIds.get(row.ingredient_name_sw);
    if (!ingredientId) throw new Error(`base_recipes references unknown ingredient "${row.ingredient_name_sw}"`);

    await db()
      .insertInto("ref.base_recipe_ingredients")
      .values({
        recipe_id: recipeId,
        ingredient_id: ingredientId,
        qty_per_base: row.qty_per_10_plates_g,
        is_optional: row.is_optional === "TRUE",
      })
      .onConflict((oc) =>
        oc.columns(["recipe_id", "ingredient_id"]).doUpdateSet({
          qty_per_base: row.qty_per_10_plates_g,
          is_optional: row.is_optional === "TRUE",
        }),
      )
      .execute();
    recipeIngredientCount++;
  }

  return { recipes: recipeIds.size, recipeIngredients: recipeIngredientCount };
}

async function printSpotChecks(): Promise<void> {
  console.log("\n--- spot checks ---");

  const pilau = await db()
    .selectFrom("ref.base_recipes as r")
    .innerJoin("ref.base_recipe_ingredients as ri", "ri.recipe_id", "r.id")
    .innerJoin("ref.ingredients as i", "i.id", "ri.ingredient_id")
    .select(["r.name_sw as recipe", "i.name_sw as ingredient", "ri.qty_per_base"])
    .where("r.name_sw", "=", "Pilau ya nyama")
    .orderBy("ri.qty_per_base", "desc")
    .execute();
  console.log("1) Pilau ya nyama ingredients (qty per 10 plates, g):");
  console.table(pilau);

  const riceUnits = await db()
    .selectFrom("ref.ingredient_units as u")
    .innerJoin("ref.ingredients as i", "i.id", "u.ingredient_id")
    .innerJoin("ref.markets as m", "m.id", "u.market_id")
    .select(["m.name as market", "u.unit_name_sw", "u.grams_per_unit"])
    .where("i.name_sw", "=", "Mchele")
    .execute();
  console.log("2) Mchele (rice) informal units per market:");
  console.table(riceUnits);

  const counts = await db()
    .selectFrom("ref.markets")
    .select(({ fn }) => [fn.count<number>("id").as("markets")])
    .executeTakeFirst();
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
  await closeDb();
  console.log("\nFaida seed loader — done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
