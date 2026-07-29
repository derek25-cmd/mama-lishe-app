import { Kysely, PostgresDialect, type Generated } from "kysely";
import pg from "pg";

// Typed schema surface for the tables the seed loader and costing/vendor
// modules touch so far (DOC 05 §2-§4). Extended as later tasks add routes —
// deliberately not the *whole* schema up front.
export interface Database {
  "ref.regions": {
    id: Generated<string>;
    name: string;
    code: string;
  };
  "ref.markets": {
    id: Generated<string>;
    region_id: string;
    name: string;
    lat: number | null;
    lng: number | null;
    geofence_radius_m: Generated<number | null>;
    is_active: Generated<boolean>;
  };
  "ref.ingredients": {
    id: Generated<string>;
    name_sw: string;
    name_en: string;
    category: string;
    canonical_unit: "g" | "ml";
    is_active: Generated<boolean>;
  };
  "ref.ingredient_units": {
    id: Generated<string>;
    ingredient_id: string;
    market_id: string | null;
    unit_name_sw: string;
    grams_per_unit: number;
    valid_from: Generated<string>;
    valid_to: string | null;
    source: Generated<string>;
  };
  "ref.base_recipes": {
    id: Generated<string>;
    name_sw: string;
    name_en: string;
    category: string | null;
    base_plates: Generated<number>;
    version: Generated<number>;
    is_active: Generated<boolean>;
  };
  "ref.base_recipe_ingredients": {
    recipe_id: string;
    ingredient_id: string;
    qty_per_base: number;
    is_optional: Generated<boolean>;
  };
  "vendor.vendors": {
    id: string;
    phone: string;
    display_name: string;
    business_type: "mama_lishe" | "duka" | "other";
    market_id: string | null;
    region_id: string | null;
    language: Generated<string>;
    target_margin_pct: Generated<number>;
    points: Generated<number>;
    status: Generated<string>;
    consent_pdpa_at: Date | null;
    created_at: Generated<Date>;
  };
}

let instance: Kysely<Database> | undefined;

// A single process-wide pool. Callers that need per-request RLS context
// (SET ROLE / app.vendor_id) must use withVendorContext() below rather than
// running queries directly against this instance.
export function db(): Kysely<Database> {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    instance = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
    });
  }
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = undefined;
  }
}
