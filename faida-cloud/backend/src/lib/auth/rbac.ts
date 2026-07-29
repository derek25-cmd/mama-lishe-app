export type Role = "owner" | "manager" | "staff";

const HIERARCHY: Record<Role, number> = { owner: 3, manager: 2, staff: 1 };

/** Returns true if `actual` meets or exceeds `required`. */
export function hasRole(actual: Role, required: Role): boolean {
  return HIERARCHY[actual] >= HIERARCHY[required];
}
