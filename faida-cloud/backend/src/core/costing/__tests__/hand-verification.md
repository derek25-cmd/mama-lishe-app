# Hand-verified fixtures

Per the standing rule: golden files were generated only after these two
were worked out by hand, arithmetic first. If a generated golden file ever
disagrees with the numbers below, the golden file is wrong until proven
otherwise — not the other way around.

## Fixture A — single dish: Pilau ya Nyama × 60 plates, 40% target margin

Scale factor = 60/10 = 6.

| ingredient | raw qty | category | rounded | display | unit price | line cost |
|---|---|---|---|---|---|---|
| rice | 12000 g | nafaka (0.5kg steps) | 12000 g (exact) | 12 kg | 2800/kg | 33,600 |
| meat | 18000 g | nyama (0.25kg steps) | 18000 g (exact) | 18 kg | 12000/kg | 216,000 |
| oil | 3000 ml | mafuta (bottles) | one 3L bottle (exact) | 1 chupa | 6500/kg | 19,500 |
| pilau_masala | 600 g | viungo (flat allowance) | n/a | 1 kiasi | — | 200×60 = 12,000 |
| onion | 6000 g | mboga (unit table) | 6000g > 4×250g fungu → switch to kilo | 6 kilo | 1500/kg | 9,000 |

Total cost = 33,600 + 216,000 + 19,500 + 12,000 + 9,000 = **290,100 TZS**

Single dish, so all cost apportions to it: dish_cost_tzs = 290,100.

- cost_per_plate = ceil(290100 / 60) = **4,835** (exact division)
- raw price = 4835 / 0.6 = 8058.33...
- recommended_price = ceil(8058.33 / 500) × 500 = 17 × 500 = **8,500**
- achieved_margin = (1 − 4835/8500) × 100 = **43.1176...%**

## Fixture B — multi-dish: Pilau ya Nyama × 60 + Wali Maharage × 30, 35% margin

Wali Maharage scale factor = 30/10 = 3: rice 4500g, beans 3000g, oil 600ml.

Merged lines (rice and oil are shared between the two dishes):

| ingredient | total raw qty | dish0 (pilau) raw | dish1 (wali) raw | rounded | line cost |
|---|---|---|---|---|---|
| rice | 16500 g | 12000 g | 4500 g | 16500 g (33×500, exact) | 33 × 2800 × 0.5 = 46,200 |
| meat | 18000 g | 18000 g | — | 18000 g | 216,000 |
| oil | 3600 ml | 3000 ml | 600 ml | packed: 3000+500+500=4000ml (3 bottles) | 4 × 6500 = 26,000 |
| pilau_masala | 600 g | 600 g | — | n/a (viungo) | 200×60 = 12,000 |
| onion | 6000 g | 6000 g | — | 6 kilo | 9,000 |
| beans | 3000 g | — | 3000 g | 3 kg (exact) | 3 × 3200 = 9,600 |

Total cost = 46,200+216,000+26,000+12,000+9,000+9,600 = **318,800 TZS**

Apportionment of shared lines (largest-remainder method):

- **rice** (46,200 total): 46200/16500 = 2.8 exactly → dish0 = 12000×2.8 = 33,600.0,
  dish1 = 4500×2.8 = 12,600.0. Both already integers, no remainder to
  distribute. dish0 += 33,600, dish1 += 12,600.
- **oil** (26,000 total): 26000/3600 = 7.2222... → dish0 raw = 3000×7.2222 =
  21,666.67, dish1 raw = 600×7.2222 = 4,333.33. Floors: 21666 + 4333 =
  25,999, remainder = 1, goes to the larger fraction (dish0, frac .667) →
  dish0 += 21,667, dish1 += 4,333. Sum check: 21667+4333 = 26,000 ✓.
- meat, pilau_masala, onion → 100% to dish0 (only pilau uses them).
- beans → 100% to dish1 (only wali maharage uses it).

dish0 (pilau) total = 33,600+216,000+21,667+12,000+9,000 = **292,267**
dish1 (wali) total = 12,600+4,333+9,600 = **26,533**

Sum check: 292,267 + 26,533 = 318,800 ✓ — matches total_cost_tzs exactly,
no shilling lost.

**dish0 margins** (plates=60, target 35%): cost_per_plate = ceil(292267/60)
= 4,872. raw price = 4872/0.65 = 7495.38... → recommended = ceil(7495.38/500)
× 500 = 15×500 = **7,500**. achieved = (1 − 4872/7500)×100 = **35.04%**

**dish1 margins** (plates=30, target 35%): cost_per_plate = ceil(26533/30)
= 885. raw price = 885/0.65 = 1361.54... → recommended = ceil(1361.54/500)
× 500 = 3×500 = **1,500**. achieved = (1 − 885/1500)×100 = **41.0%**
