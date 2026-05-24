import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Check, ChevronDown, Plus, X, Search, Download, Copy, Mail,
  Droplet, Tent, Flame, Utensils, Wrench, Heart, Sparkles,
  Shirt, Baby, Truck, Radio, RotateCcw, Trash2, FileText, Send,
  Apple, Refrigerator, Lightbulb, Compass, ListChecks, Sandwich,
  ShowerHead, Footprints, ClipboardCheck, Sun, MapPin, Users, Beer, Wine,
  Fuel, AlertTriangle, ArrowRight, UserCheck, RefreshCw
} from 'lucide-react';
import { supabase, generateTripCode } from '../lib/supabase';

/* ---------------------------------------------------------------
   THE FIELD MANIFEST
   A living packing list for weekend escapes to the big lap.
   --------------------------------------------------------------- */

const STORAGE_KEY = 'field-manifest-v1';

const C = {
  bg: '#EFE3C2',
  paper: '#FBF5E2',
  paper2: '#F4E9C8',
  ink: '#1C1813',
  ink2: '#3A3128',
  muted: '#7A6E59',
  rule: '#D6C49C',
  rust: '#A8471A',
  rustDk: '#7C3411',
  rustLt: '#E5C3A8',
  forest: '#26402F',
  forestDk: '#162A1D',
  forestLt: '#C4D3BF',
  ochre: '#C58A2A',
  ochreLt: '#F1DCA8',
  sky: '#3F5F70',
};

const DEFAULTS = {
  adults: 2,
  kids: 0,
  nights: 3,
  setup: 'tent',          // tent | swag | camper | caravan
  remote: false,
  fourwd: false,
  cold: false,
  fishing: false,
  fire: true,
  csr: false,             // Canning Stock Route mode (unlocks expedition section)
  fuelL: 0,               // optional manual fuel litres for CSR planning
};

// ---- desert / CSR scaling ----
// On the CSR plan ~10L/person/day water (drinking + cooking + bare-minimum hygiene).
// Typical CSR fuel consumption: 25–35 L/100km in sand, plan on 600–800 L for the run.
const waterPerDay = (c) => c.csr ? 10 : 4;
const kidsWaterPerDay = (c) => c.csr ? 8 : 2;

// ---- quantity hint helpers ----
const ppl = (c) => c.adults + c.kids;
const totalWaterL = (c) => Math.ceil(c.adults * waterPerDay(c) * c.nights + c.kids * kidsWaterPerDay(c) * c.nights);
const Q = {
  water:    c => `${totalWaterL(c)} L`,
  bottles:  c => `${ppl(c)} × 1L`,
  eggs:     c => `${Math.min(ppl(c) * c.nights, 24)} eggs`,
  bread:    c => `${Math.max(1, Math.ceil(ppl(c) * c.nights / 5))} loaf`,
  milk:     c => `${Math.max(1, Math.ceil(ppl(c) * c.nights * 0.25))} L`,
  coffee:   c => `${Math.ceil(Math.max(1, c.adults) * c.nights * 25)} g`,
  pasta:    c => `${Math.max(1, Math.ceil(ppl(c) * c.nights / 6))} × 500g`,
  rice:     c => `${Math.max(1, Math.ceil(ppl(c) * c.nights / 8))} × 500g`,
  sausages: c => `${ppl(c) * 2}`,
  mince:    c => `${Math.ceil(ppl(c) * 0.2 * 100) / 100} kg`,
  tp:       c => `${Math.max(2, Math.ceil(ppl(c) * c.nights / 4))} rolls`,
  gas:      c => c.csr ? '3+ bottles' : (c.nights > 5 ? '2 bottles' : '1 bottle'),
  socks:    c => `${ppl(c)} × ${Math.max(c.nights, 3)} pr`,
  undies:   c => `${ppl(c)} × ${c.nights + 1}`,
  tshirts:  c => `${ppl(c)} × ${Math.max(2, Math.ceil(c.nights / 2))}`,
  // CSR-specific
  fuel:     c => `${c.fuelL || 700} L`,
  jerries:  c => `${Math.max(4, Math.ceil(((c.fuelL || 700) - 140) / 20))} × 20 L`, // assume 140L main tank
  maxtrax:  c => '4 boards minimum',
  permits:  c => 'Martu · Birriliburu · Ngurrara · Karlamilyi',
};

// =====================================================================
//  PAYLOAD CALCULATOR — sums actual per-item weights for ticked items.
//  Items that have no `wt` field contribute nothing (e.g. documents, actions).
//  Items with config-aware weights (water, fuel, anything that scales by
//  people × nights) are evaluated against the current trip profile.
// =====================================================================

// Resolve a single item's weight in kg (number or function of config).
function itemKg(item, config) {
  if (item == null || item.wt == null) return 0;
  try {
    const v = typeof item.wt === 'function' ? item.wt(config) : item.wt;
    return Number.isFinite(v) ? v : 0;
  } catch (e) { return 0; }
}

// Determine whether a category is visible at all for this config.
function categoryVisible(cat, config) {
  return !cat.only || cat.only(config);
}

// Determine whether an item is "active" — i.e. visible to this user given
// trip config and not removed from their list.
function itemActive(item, config, hidden) {
  if (hidden[item.id]) return false;
  if (item.when && !item.when(config)) return false;
  return true;
}

// Sum weights across the manifest, grouped by category, only counting items
// that are CHECKED (i.e. the user has chosen to pack them) and active.
// Returns { total, byCategory: [{id, title, kg}], heaviestItems: [...] }
function computePayload(config, checked, hidden, custom) {
  let total = 0;
  const byCategory = [];
  const allRows = [];

  for (const cat of CATEGORIES) {
    if (!categoryVisible(cat, config)) continue;
    let catKg = 0;
    const baseItems = cat.items.filter(it => itemActive(it, config, hidden));
    const extraItems = custom[cat.id] || [];
    for (const it of [...baseItems, ...extraItems]) {
      if (!checked[it.id]) continue;
      const w = itemKg(it, config);
      catKg += w;
      if (w > 0) allRows.push({ id: it.id, name: it.name, kg: w, cat: cat.title });
    }
    total += catKg;
    byCategory.push({ id: cat.id, title: cat.title, kg: catKg, tint: cat.tint });
  }

  // Top 3 heaviest individual items — gives the user a quick view of what's
  // dominating their payload (almost always water + fuel + recovery).
  const heaviestItems = [...allRows].sort((a, b) => b.kg - a.kg).slice(0, 3);

  return {
    total: Math.round(total),
    byCategory: byCategory.sort((a, b) => b.kg - a.kg),
    heaviestItems,
  };
}

// Convenience: sum of every "plannable" item (i.e. what the load would be
// if the user ticked everything currently visible). Useful for showing the
// gap between "what I've packed" and "what's on the list".
function computePlannedPayload(config, hidden, custom) {
  let total = 0;
  for (const cat of CATEGORIES) {
    if (!categoryVisible(cat, config)) continue;
    const baseItems = cat.items.filter(it => itemActive(it, config, hidden));
    const extraItems = custom[cat.id] || [];
    for (const it of [...baseItems, ...extraItems]) {
      total += itemKg(it, config);
    }
  }
  return Math.round(total);
}

// =====================================================================
//  ROAD JOURNAL — fuel + cost + distance tracking
//  Convention: each entry represents a fill-up at a moment in time.
//  Distance between fill-ups is derived from odometer deltas. Fuel
//  consumption for the leg is litres-poured ÷ km-since-last × 100.
//  Lifetime averages exclude the first fill (it's the starting state,
//  not "fuel used since something").
// =====================================================================
function sortJournalAsc(entries) {
  return [...entries].sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    if (d !== 0) return d;
    return (Number(a.odo) || 0) - (Number(b.odo) || 0);
  });
}

function computeJournalStats(entries) {
  if (!entries || entries.length === 0) {
    return {
      count: 0, totalLitres: 0, totalCost: 0, totalDistance: 0,
      avgConsumption: null, avgCostPerKm: null, avgPricePerL: null,
      firstDate: null, lastDate: null, lastOdo: null,
    };
  }
  const sorted = sortJournalAsc(entries);
  const totalLitres = entries.reduce((a, e) => a + (Number(e.litres) || 0), 0);
  const totalCost   = entries.reduce((a, e) => a + (Number(e.totalCost) || 0), 0);

  const firstOdo = Number(sorted[0]?.odo) || 0;
  const lastOdo  = Number(sorted[sorted.length - 1]?.odo) || 0;
  const totalDistance = Math.max(0, lastOdo - firstOdo);

  let avgConsumption = null;
  let avgCostPerKm   = null;
  if (sorted.length >= 2 && totalDistance > 0) {
    const litresAfterFirst = sorted.slice(1).reduce((a, e) => a + (Number(e.litres) || 0), 0);
    const costAfterFirst   = sorted.slice(1).reduce((a, e) => a + (Number(e.totalCost) || 0), 0);
    avgConsumption = (litresAfterFirst * 100) / totalDistance;
    avgCostPerKm   = costAfterFirst / totalDistance;
  }

  return {
    count: entries.length,
    totalLitres,
    totalCost,
    totalDistance,
    avgConsumption,
    avgCostPerKm,
    avgPricePerL: totalLitres > 0 ? totalCost / totalLitres : null,
    firstDate: sorted[0]?.date || null,
    lastDate:  sorted[sorted.length - 1]?.date || null,
    lastOdo,
  };
}

// Attach per-leg derived values to each entry, returned in REVERSE
// chronological order (newest first) for display.
function deriveJournalForDisplay(entries) {
  const sorted = sortJournalAsc(entries);
  const decorated = sorted.map((e, i) => {
    if (i === 0) return { ...e, kmSince: null, legConsumption: null, isFirst: true };
    const prev = sorted[i - 1];
    const kmSince = Math.max(0, (Number(e.odo) || 0) - (Number(prev.odo) || 0));
    const litres  = Number(e.litres) || 0;
    const legConsumption = kmSince > 0 && litres > 0 ? (litres * 100) / kmSince : null;
    return { ...e, kmSince, legConsumption, isFirst: false };
  });
  return decorated.reverse();
}

// =====================================================================
//  CATEGORY DATA
// =====================================================================
const CATEGORIES = [
  {
    id: 'admin',
    title: 'Pre-departure',
    blurb: 'Documents, vehicle, the boring bits that ruin a trip if forgotten.',
    icon: FileText,
    tint: 'forest',
    items: [
      { id: 'a01', name: "Driver's licence (everyone driving)" },
      { id: 'a02', name: 'Vehicle registration current' },
      { id: 'a03', name: 'Insurance & roadside details' },
      { id: 'a04', name: 'National Parks pass / camping permits' },
      { id: 'a05', name: 'Booking confirmations printed or saved offline' },
      { id: 'a06', name: 'Cash + cards (some places card-only fails)' },
      { id: 'a07', name: 'Vehicle serviced — oil, filters, brakes' },
      { id: 'a08', name: 'Tyre pressures + spare checked' },
      { id: 'a09', name: 'Fluids topped (washer, coolant, oil)' },
      { id: 'a10', name: 'Fuel tanks full + jerry plan for remote legs', when: c => c.remote },
      { id: 'a11', name: 'Trip plan shared with someone at home', when: c => c.remote },
      { id: 'a12', name: 'Mail / pets / plants arranged' },
    ],
  },
  {
    id: 'water',
    title: 'Water & Hydration',
    blurb: 'Three to four litres per adult per day — assume more if hot or active.',
    icon: Droplet,
    tint: 'sky',
    items: [
      { id: 'w01', name: 'Drinking water', qty: Q.water, wt: c => totalWaterL(c) },
      { id: 'w02', name: 'Reusable water bottles', qty: Q.bottles, wt: c => 0.15 * ppl(c) },
      { id: 'w03', name: 'Jerry cans / water tanks for top-up', when: c => c.nights > 2 || c.remote, wt: c => (c.nights > 2 || c.remote) ? 9 : 0 },
      { id: 'w04', name: 'Water bladder / hydration pack', wt: 0.5 },
      { id: 'w05', name: 'Water filter or purification tabs', when: c => c.remote, wt: 0.3 },
      { id: 'w06', name: 'Electrolyte / hydration sachets', wt: 0.2 },
      { id: 'w07', name: 'Thermos / insulated bottle', wt: 0.5 },
      { id: 'w08', name: 'Ice (esky / fridge cold-pack)', wt: 5 },
    ],
  },
  {
    id: 'pantry',
    title: 'Pantry — non-perishables',
    blurb: 'The flavour bones. Decant into containers to save space.',
    icon: Sandwich,
    tint: 'ochre',
    items: [
      { id: 'p01', name: 'Olive oil', wt: 0.75 },
      { id: 'p02', name: 'Balsamic vinegar', wt: 0.5 },
      { id: 'p03', name: 'Soy sauce', wt: 0.3 },
      { id: 'p04', name: 'Salt + pepper grinder', wt: 0.3 },
      { id: 'p05', name: 'Dried herbs — chilli flakes, oregano, mixed', wt: 0.15 },
      { id: 'p06', name: 'Mustard', wt: 0.3 },
      { id: 'p07', name: 'Mayo (squeeze bottle)', wt: 0.4 },
      { id: 'p08', name: 'Honey', wt: 0.5 },
      { id: 'p09', name: 'Maple syrup', wt: 0.4 },
      { id: 'p10', name: 'Vegemite', wt: 0.4 },
      { id: 'p11', name: 'Jam', wt: 0.4 },
      { id: 'p12', name: 'Tahini (unhulled)', wt: 0.5 },
      { id: 'p13', name: 'Peanut butter', wt: 0.5 },
      { id: 'p14', name: 'Almond butter', wt: 0.4 },
      { id: 'p15', name: 'Black tea bags', wt: 0.1 },
      { id: 'p16', name: 'Rooibos tea bags', wt: 0.1 },
      { id: 'p17', name: 'Coffee — ground / beans / plunger grind', qty: Q.coffee, wt: c => Math.max(0.25, Math.ceil(Math.max(1, c.adults) * c.nights * 0.025 * 100) / 100) },
      { id: 'p18', name: 'Hot chocolate', wt: 0.4 },
      { id: 'p19', name: 'Sugar', wt: 0.5 },
      { id: 'p20', name: 'Cereal / granola', wt: 0.5 },
      { id: 'p21', name: 'Instant oats', wt: 0.5 },
      { id: 'p22', name: 'Pasta — spaghetti + spirals', qty: Q.pasta, wt: c => Math.max(0.5, Math.ceil(ppl(c) * c.nights / 6) * 0.5) },
      { id: 'p23', name: 'White rice', qty: Q.rice, wt: c => Math.max(0.5, Math.ceil(ppl(c) * c.nights / 8) * 0.5) },
      { id: 'p24', name: 'Black rice / tri-colour quinoa', wt: 0.5 },
      { id: 'p25', name: 'Mutti chopped tomatoes', qty: () => '3 × 400g', wt: 1.2 },
      { id: 'p26', name: 'Tinned tuna in oil', qty: () => '2–3 tins', wt: 0.55 },
      { id: 'p27', name: 'Anchovies', wt: 0.1 },
      { id: 'p28', name: 'Baby capers', wt: 0.2 },
      { id: 'p29', name: 'Stock cubes or liquid stock', wt: 0.15 },
      { id: 'p30', name: 'Crackers (vinegar / chia)', wt: 0.3 },
      { id: 'p31', name: 'Corn chips', wt: 0.4 },
      { id: 'p32', name: 'Tortillas / wraps', wt: 0.5 },
      { id: 'p33', name: 'Trail mix', wt: 0.4 },
      { id: 'p34', name: 'Mixed nuts', wt: 0.4 },
      { id: 'p35', name: 'Dried fruit', wt: 0.3 },
      { id: 'p36', name: 'Pumpkin seeds with Himalayan salt', wt: 0.3 },
      { id: 'p37', name: 'Energy bars / muesli bars', wt: 0.5 },
      { id: 'p38', name: 'Marshmallows', when: c => c.fire, wt: 0.3 },
      { id: 'p39', name: 'Chocolate — adults + kids', when: c => c.kids === 0 || true, wt: 0.3 },
      { id: 'p40', name: 'Biscuits', wt: 0.5 },
    ],
  },
  {
    id: 'fresh',
    title: 'Fresh & Cold',
    blurb: 'Pack so fridge opens least often. Eat the soft stuff first.',
    icon: Refrigerator,
    tint: 'forest',
    items: [
      { id: 'f01', name: 'Almond / oat milk', qty: Q.milk, wt: c => Math.max(1, Math.ceil(ppl(c) * c.nights * 0.25)) },
      { id: 'f02', name: 'Butter', wt: 0.25 },
      { id: 'f03', name: 'Coconut yoghurt', wt: 0.5 },
      { id: 'f04', name: 'Eggs', qty: Q.eggs, wt: c => Math.min(ppl(c) * c.nights, 24) * 0.06 },
      { id: 'f05', name: 'Bread', qty: Q.bread, wt: c => Math.max(1, Math.ceil(ppl(c) * c.nights / 5)) * 0.7 },
      { id: 'f06', name: 'Wraps', wt: 0.3 },
      { id: 'f07', name: 'Burger buns', wt: 0.4 },
      { id: 'f08', name: 'Cheese — grated + sliced', wt: 0.5 },
      { id: 'f09', name: 'Feta', wt: 0.2 },
      { id: 'f10', name: 'Good ham (skip if average)', wt: 0.3 },
      { id: 'f11', name: 'Bacon', wt: 0.5 },
      { id: 'f12', name: 'Chicken tenderloins (bowls + salad)', wt: 0.8 },
      { id: 'f13', name: 'Beef mince (bolognese)', qty: Q.mince, wt: c => Math.ceil(ppl(c) * 0.2 * 100) / 100 },
      { id: 'f14', name: 'Diced beef for potjie', when: c => c.nights > 1, wt: 0.8 } ,
      { id: 'f15', name: 'Good sausages — Cleavers or similar', qty: Q.sausages, wt: c => ppl(c) * 2 * 0.1 },
      { id: 'f16', name: 'Smoked trout / salmon (if decent)', wt: 0.3 },
      { id: 'f17', name: 'Hummus', wt: 0.25 },
      { id: 'f18', name: 'Lemons / limes', wt: 0.3 },
      { id: 'f19', name: 'Avocados', wt: 0.4 },
      { id: 'f20', name: 'Tomatoes', wt: 0.5 },
      { id: 'f21', name: 'Cucumber', wt: 0.4 },
      { id: 'f22', name: 'Rocket / salad mix', wt: 0.2 },
      { id: 'f23', name: 'Fresh herbs — parsley, dill, mint', wt: 0.1 },
      { id: 'f24', name: 'Onions', wt: 0.5 },
      { id: 'f25', name: 'Garlic', wt: 0.1 },
      { id: 'f26', name: 'Carrots', wt: 0.5 },
      { id: 'f27', name: 'Red pepper / capsicum', wt: 0.3 },
      { id: 'f28', name: 'Green beans', wt: 0.3 },
      { id: 'f29', name: 'Broccoli', wt: 0.4 },
      { id: 'f30', name: 'Fennel', wt: 0.4 },
      { id: 'f31', name: 'Sweet potatoes', wt: 0.6 },
      { id: 'f32', name: 'Jacket potatoes', wt: 0.8 },
      { id: 'f33', name: 'Bananas (pack carefully)', wt: 0.6 },
      { id: 'f34', name: 'Mandarins / kiwi / berries', wt: 0.6 },
    ],
  },
  {
    id: 'drinks',
    title: 'Drinks & libations',
    blurb: 'A slab is 10 kg. A cask is two bottles for half the weight. Choose wisely.',
    icon: Wine,
    tint: 'ochre',
    items: [
      // ---- Cold non-alcoholic ----
      { id: 'd01', name: 'Soft drinks (mixed cans, kids + mixers)', qty: c => `${Math.max(6, c.kids * c.nights * 2)} cans`, wt: c => Math.max(6, c.kids * c.nights * 2) * 0.4 },
      { id: 'd02', name: 'Cordial concentrate (stretches a long way)', wt: 1.2 },
      { id: 'd03', name: 'Soda / mineral water', qty: () => '6 cans', wt: 2.4 },
      { id: 'd04', name: 'Coconut water (the hangover hedge)', wt: 1 },
      { id: 'd05', name: 'Sports drinks / Powerade for the kids', when: c => c.kids > 0, wt: c => c.kids * 0.6 },

      // ---- Beer ----
      { id: 'd06', name: 'Slab of full-strength beer (24 cans)', qty: c => `${Math.max(1, Math.ceil(c.adults * c.nights * 3 / 24))} slab`, wt: c => Math.max(1, Math.ceil(c.adults * c.nights * 3 / 24)) * 9.6 },
      { id: 'd07', name: 'Mid-strength beer (longer sessions, less mass)', when: c => c.adults > 1, wt: 9.6 },
      { id: 'd08', name: 'Light beer for the driver', wt: 4.8 },
      { id: 'd09', name: 'Craft beer six-pack (the indulgence)', wt: 2.4 },

      // ---- Wine ----
      { id: 'd10', name: 'Red wine — bottles', qty: c => `${Math.max(1, Math.ceil(c.adults * c.nights / 4))} btl`, wt: c => Math.max(1, Math.ceil(c.adults * c.nights / 4)) * 1.2 },
      { id: 'd11', name: 'White wine — bottles', qty: () => '1–2 btl', wt: 2.4 },
      { id: 'd12', name: 'Cask wine 4 L (the touring secret)', wt: 4.5 },
      { id: 'd13', name: 'Sparkling for the milestone toast', wt: 1.3 },

      // ---- Spirits & cocktails ----
      { id: 'd14', name: 'Whisky — 700 mL', wt: 1.1 },
      { id: 'd15', name: 'Gin + tonic water (the campsite classic)', wt: 2.6 },
      { id: 'd16', name: 'Rum — 700 mL', wt: 1.1 },
      { id: 'd17', name: 'Pre-batched cocktails in a bottle', wt: 1 },
      { id: 'd18', name: 'Cocktail bitters + small bar kit', wt: 0.4 },

      // ---- Context note (no weight) ----
      { id: 'd19', name: 'Check Cape York / NT community alcohol restrictions before loading', wt: 0 },
    ],
  },
  {
    id: 'cook',
    title: 'Cooking & Kitchen',
    blurb: 'The fire and the flame. Strip back, but keep two pots and a sharp knife.',
    icon: Utensils,
    tint: 'rust',
    items: [
      { id: 'c01', name: 'Compact gas stove', wt: 1.5 },
      { id: 'c02', name: 'Gas bottle(s)', qty: Q.gas, wt: c => c.csr ? 27 : (c.nights > 5 ? 16 : 8) },
      { id: 'c03', name: 'Lighter + waterproof matches', wt: 0.1 },
      { id: 'c04', name: 'Firelighters / fatwood', when: c => c.fire, wt: 0.2 },
      { id: 'c05', name: 'Camp oven / potjie / Dutch oven', when: c => c.fire || c.nights > 2, wt: 6 },
      { id: 'c06', name: 'Cast-iron skillet', wt: 3 },
      { id: 'c07', name: 'Pots — small + medium', wt: 2.5 },
      { id: 'c08', name: 'Frying pan', wt: 1.5 },
      { id: 'c09', name: 'Kettle', wt: 0.8 },
      { id: 'c10', name: 'Plates', qty: c => `${ppl(c)} +1` },
      { id: 'c11', name: 'Bowls', qty: c => `${ppl(c)} +1` },
      { id: 'c12', name: 'Cups / mugs', qty: c => `${ppl(c)} +1` },
      { id: 'c13', name: 'Wine / enamel glasses', wt: 0.4 },
      { id: 'c14', name: 'Cutlery set', qty: c => `${ppl(c)} +2` },
      { id: 'c15', name: 'Cooking utensils — spatula, ladle, wooden spoon, tongs', wt: 0.6 },
      { id: 'c16', name: 'Chef knife + paring knife', wt: 0.4 },
      { id: 'c17', name: 'Thin plastic cutting board', wt: 0.3 },
      { id: 'c18', name: 'Mixing bowl', wt: 0.3 },
      { id: 'c19', name: 'Can + bottle opener', wt: 0.1 },
      { id: 'c20', name: 'Cheese grater', wt: 0.2 },
      { id: 'c21', name: 'Peeler', wt: 0.05 },
      { id: 'c22', name: 'Trivet / heat pad', wt: 0.3 },
      { id: 'c23', name: 'Aluminium foil', wt: 0.3 },
      { id: 'c24', name: 'Ziplock + reusable containers', wt: 0.5 },
      { id: 'c25', name: 'Coffee plunger / Aeropress / Moka', wt: 0.5 },
      { id: 'c26', name: 'Grill plate / BBQ plate', when: c => c.fire, wt: 1.5 },
      { id: 'c27', name: 'Fire tripod / grate', when: c => c.fire && c.nights > 1, wt: 2 },
    ],
  },
  {
    id: 'shelter',
    title: 'Shelter & Setup',
    blurb: 'The roof above. Pitch in daylight — every time.',
    icon: Tent,
    tint: 'forest',
    items: [
      { id: 's01', name: 'Tent / swag / camper / caravan', wt: c => ({ tent: 8, swag: 12, camper: 0, caravan: 0 })[c.setup] || 8 },
      { id: 's02', name: 'Tent pegs + spares', wt: 1 },
      { id: 's03', name: 'Mallet / hammer', wt: 0.8 },
      { id: 's04', name: 'Guy ropes (with tensioners)', wt: 0.3 },
      { id: 's05', name: 'Footprint / groundsheet', wt: 1 },
      { id: 's06', name: 'Tarp', wt: 2.5 },
      { id: 's07', name: 'Tarp poles', wt: 3 },
      { id: 's08', name: 'Sand pegs (beach / soft ground)', wt: 0.5 },
      { id: 's09', name: 'Awning / annex', when: c => ['camper','caravan'].includes(c.setup), wt: 8 },
      { id: 's10', name: 'Annex walls (wind / cold)', when: c => c.cold, wt: 6 },
      { id: 's11', name: 'Tent repair kit', wt: 0.2 },
      { id: 's12', name: 'Broom / brush (sand patrol)', wt: 0.3 },
      { id: 's13', name: 'Outdoor mat / floor mat', wt: 3 },
      { id: 's14', name: 'Cool Cabana / beach shade', wt: 6 },
      { id: 's15', name: 'Fairy lights / bunting', wt: 0.3 },
    ],
  },
  {
    id: 'sleep',
    title: 'Sleeping & Bedding',
    blurb: 'Bad sleep ruins a good campsite. Over-invest here.',
    icon: Footprints,
    tint: 'sky',
    items: [
      { id: 'sl01', name: 'Sleeping bag (per person)', qty: c => `${ppl(c)}` },
      { id: 'sl02', name: 'Sleeping bag liner', wt: c => 0.3 * ppl(c) },
      { id: 'sl03', name: 'Pillow (real, not the camping kind)', qty: c => `${ppl(c)}` },
      { id: 'sl04', name: 'Self-inflating mat / Mountmat / swag mattress', wt: c => 2 * ppl(c) },
      { id: 'sl05', name: 'Camp stretcher', wt: c => 5 * ppl(c) },
      { id: 'sl06', name: 'Extra blanket / doona', when: c => c.cold || c.nights > 3, wt: 2 },
      { id: 'sl07', name: 'Hot water bottle', when: c => c.cold, wt: 0.3 },
      { id: 'sl08', name: 'Eye mask + earplugs', wt: 0.1 },
      { id: 'sl09', name: "Kid's comfort toy / blanket", when: c => c.kids > 0, wt: 0.3 },
    ],
  },
  {
    id: 'power',
    title: 'Power & Lighting',
    blurb: 'Headlamps beat hand torches. Always charge before you arrive.',
    icon: Lightbulb,
    tint: 'ochre',
    items: [
      { id: 'pw01', name: 'Headlamp (per person)', qty: c => `${ppl(c)}` },
      { id: 'pw02', name: 'Spare hand torch', wt: 0.3 },
      { id: 'pw03', name: 'Lantern', wt: 0.7 },
      { id: 'pw04', name: 'Camp light strip / fairy lights', wt: 0.3 },
      { id: 'pw05', name: 'Spare batteries (AAA / AA)', wt: 0.2 },
      { id: 'pw06', name: 'Power bank — large capacity', wt: 0.5 },
      { id: 'pw07', name: 'Solar panel / blanket', when: c => c.nights > 2 || c.remote, wt: 6 },
      { id: 'pw08', name: 'Battery box / dual battery', wt: 25 },
      { id: 'pw09', name: '12V Anderson leads', wt: 0.5 },
      { id: 'pw10', name: '240V extension cable', when: c => c.setup !== 'tent' || c.nights > 2, wt: 1.5 },
      { id: 'pw11', name: '240V power board', wt: 0.5 },
      { id: 'pw12', name: 'Inverter', wt: 2 },
      { id: 'pw13', name: 'Charging cables — USB-C / Lightning / micro', wt: 0.3 },
      { id: 'pw14', name: '12V fridge cable', wt: 0.5 },
    ],
  },
  {
    id: 'wateruse',
    title: 'Water Management',
    blurb: 'Hoses, showers, greywater. Caravan parks like pressure regulators.',
    icon: ShowerHead,
    tint: 'sky',
    items: [
      { id: 'wm01', name: 'Drinking-water-safe hose', wt: 2 },
      { id: 'wm02', name: 'Hose fittings & adaptors', wt: 0.3 },
      { id: 'wm03', name: 'Pressure regulator', when: c => c.setup === 'caravan' || c.setup === 'camper', wt: 0.3 },
      { id: 'wm04', name: 'Bucket', wt: 0.5 },
      { id: 'wm05', name: 'Camp shower (gravity / pump / hot)', wt: 2 },
      { id: 'wm06', name: 'Shower / privacy tent', wt: 5 },
      { id: 'wm07', name: 'Collapsible water carrier', wt: 0.5 },
      { id: 'wm08', name: 'Greywater container', when: c => c.setup === 'caravan' || c.setup === 'camper', wt: 2 },
    ],
  },
  {
    id: 'tools',
    title: 'Tools & Repair',
    blurb: 'Gaffer tape and zip ties. The two great healers.',
    icon: Wrench,
    tint: 'ink',
    items: [
      { id: 't01', name: 'Multi-tool / Leatherman', wt: 0.3 },
      { id: 't02', name: 'Toolkit — spanners, screwdrivers', wt: 5 },
      { id: 't03', name: 'Cable ties (assorted)', wt: 0.2 },
      { id: 't04', name: 'Duct + gaffer tape', wt: 0.4 },
      { id: 't05', name: 'Repair kit — sewing, glue, patches', wt: 0.3 },
      { id: 't06', name: 'Rope / paracord', wt: 0.5 },
      { id: 't07', name: 'Bungee cords', wt: 0.3 },
      { id: 't08', name: 'Carabiners', wt: 0.2 },
      { id: 't09', name: 'Axe / hatchet', when: c => c.fire, wt: 1.5 },
      { id: 't10', name: 'Folding saw', when: c => c.fire, wt: 0.5 },
      { id: 't11', name: 'Shovel', wt: 2 },
      { id: 't12', name: 'WD-40 / lubricant', wt: 0.4 },
      { id: 't13', name: 'Pliers', wt: 0.3 },
    ],
  },
  {
    id: 'firstaid',
    title: 'First Aid & Safety',
    blurb: 'Australian bush rules — pressure bandages for snakes, sunscreen for everything else.',
    icon: Heart,
    tint: 'rust',
    items: [
      { id: 'fa01', name: 'First aid kit (full)', wt: 2 },
      { id: 'fa02', name: 'Snake bite kit — compression bandages ×2', wt: 0.5 },
      { id: 'fa03', name: 'Plasters / Band-Aids', wt: 0.1 },
      { id: 'fa04', name: 'Sterile gauze + tape', wt: 0.2 },
      { id: 'fa05', name: 'Saline solution', wt: 0.3 },
      { id: 'fa06', name: 'Tweezers (ticks, splinters)', wt: 0.05 },
      { id: 'fa07', name: 'Antiseptic cream / wipes', wt: 0.2 },
      { id: 'fa08', name: 'Painkillers — paracetamol + ibuprofen', wt: 0.2 },
      { id: 'fa09', name: 'Antihistamines', wt: 0.1 },
      { id: 'fa10', name: 'Sting / bite relief', wt: 0.1 },
      { id: 'fa11', name: 'Burn cream / aloe', wt: 0.2 },
      { id: 'fa12', name: 'Hydration / electrolyte sachets', wt: 0.2 },
      { id: 'fa13', name: 'Personal medications (named)', wt: 0.3 },
      { id: 'fa14', name: 'Prescription scripts (copies)', wt: 0.05 },
      { id: 'fa15', name: 'EpiPen', when: c => false, wt: 0.05 }, // off by default, user toggles
      { id: 'fa16', name: 'Sunscreen SPF50+', wt: 0.4 },
      { id: 'fa17', name: 'Lip balm with SPF', wt: 0.05 },
      { id: 'fa18', name: 'Insect repellent', wt: 0.3 },
      { id: 'fa19', name: 'After-bite gel', wt: 0.1 },
      { id: 'fa20', name: 'Thermometer', wt: 0.05 },
      { id: 'fa21', name: 'Disposable gloves', wt: 0.2 },
      { id: 'fa22', name: 'Fire extinguisher', when: c => c.setup !== 'tent', wt: 2.5 },
      { id: 'fa23', name: 'Fire blanket', when: c => c.setup !== 'tent', wt: 1 },
    ],
  },
  {
    id: 'hygiene',
    title: 'Hygiene & Bathroom',
    blurb: 'Mountain money, microfibre, and a quiet trowel.',
    icon: Sparkles,
    tint: 'ochre',
    items: [
      { id: 'h01', name: 'Toilet paper', qty: Q.tp, wt: c => Math.max(2, Math.ceil(ppl(c) * c.nights / 4)) * 0.15 },
      { id: 'h02', name: 'Wet wipes', wt: 0.5 },
      { id: 'h03', name: 'Hand sanitiser', wt: 0.3 },
      { id: 'h04', name: 'Toothbrush + toothpaste', qty: c => `${ppl(c)}` },
      { id: 'h05', name: "Kid's toothpaste", when: c => c.kids > 0, wt: 0.1 },
      { id: 'h06', name: 'Soap / body wash', wt: 0.3 },
      { id: 'h07', name: 'Shampoo + conditioner', wt: 0.6 },
      { id: 'h08', name: 'Razor + shaving cream', wt: 0.3 },
      { id: 'h09', name: 'Microfibre towel (per person)', qty: c => `${ppl(c)}` },
      { id: 'h10', name: 'Deodorant', wt: 0.15 },
      { id: 'h11', name: 'Moisturiser / hand cream', wt: 0.2 },
      { id: 'h12', name: 'Brush / comb', wt: 0.1 },
      { id: 'h13', name: 'Nail clippers', wt: 0.03 },
      { id: 'h14', name: 'Period products', wt: 0.3 },
      { id: 'h15', name: 'Camp toilet + chemicals', when: c => c.remote || c.setup === 'caravan', wt: 7 },
      { id: 'h16', name: 'Trowel (bush toilet)', when: c => c.remote, wt: 0.3 },
      { id: 'h17', name: 'Nappies + change mat', when: c => c.kids > 0, wt: 1.5 },
    ],
  },
  {
    id: 'clean',
    title: 'Cleaning & Camp Care',
    blurb: 'A tidy camp is a happy camp. Leave it cleaner than you found it.',
    icon: ListChecks,
    tint: 'forest',
    items: [
      { id: 'cl01', name: 'Bin liners (heavy duty)', wt: 0.3 },
      { id: 'cl02', name: 'Pantry liners — orange box, toms brand', wt: 0.2 },
      { id: 'cl03', name: 'Dish soap (biodegradable)', wt: 0.3 },
      { id: 'cl04', name: 'Sponges + scrubber', wt: 0.1 },
      { id: 'cl05', name: 'Tea towels', wt: 0.3 },
      { id: 'cl06', name: 'Paper towel', wt: 0.5 },
      { id: 'cl07', name: 'Multi-purpose spray', wt: 0.5 },
      { id: 'cl08', name: 'Disinfectant wipes', wt: 0.4 },
      { id: 'cl09', name: 'Rubber gloves', wt: 0.1 },
      { id: 'cl10', name: 'Drying rack / mesh hanger', wt: 0.5 },
    ],
  },
  {
    id: 'clothes',
    title: 'Clothing — per person',
    blurb: 'Layer up. Merino socks change lives.',
    icon: Shirt,
    tint: 'ink',
    items: [
      { id: 'cw01', name: 'T-shirts', qty: Q.tshirts, wt: c => 0.2 * ppl(c) * Math.max(2, Math.ceil(c.nights / 2)) },
      { id: 'cw02', name: 'Long-sleeve shirt', wt: c => 0.3 * ppl(c) },
      { id: 'cw03', name: 'Shorts', wt: c => 0.3 * ppl(c) },
      { id: 'cw04', name: 'Long pants', wt: c => 0.5 * ppl(c) },
      { id: 'cw05', name: 'Thermals — top + bottom', when: c => c.cold, wt: c => 0.4 * ppl(c) },
      { id: 'cw06', name: 'Jumper / fleece', wt: c => 0.6 * ppl(c) },
      { id: 'cw07', name: 'Down jacket', when: c => c.cold, wt: c => 0.6 * ppl(c) },
      { id: 'cw08', name: 'Rain jacket', wt: c => 0.5 * ppl(c) },
      { id: 'cw09', name: 'Sun hat (broad brim)', wt: c => 0.1 * ppl(c) },
      { id: 'cw10', name: 'Beanie', when: c => c.cold, wt: c => 0.1 * ppl(c) },
      { id: 'cw11', name: 'Buff / scarf', wt: c => 0.1 * ppl(c) },
      { id: 'cw12', name: 'Underwear', qty: Q.undies, wt: c => 0.05 * ppl(c) * (c.nights + 1) },
      { id: 'cw13', name: 'Merino socks', qty: Q.socks, wt: c => 0.06 * ppl(c) * Math.max(c.nights, 3) },
      { id: 'cw14', name: 'Swimwear', wt: c => 0.2 * ppl(c) },
      { id: 'cw15', name: 'PJs / sleep layer', wt: c => 0.3 * ppl(c) },
      { id: 'cw16', name: 'Hiking shoes / boots', wt: c => 1 * ppl(c) },
      { id: 'cw17', name: 'Camp shoes / thongs / sandals', wt: c => 0.4 * ppl(c) },
      { id: 'cw18', name: 'Sunglasses', wt: c => 0.05 * ppl(c) },
      { id: 'cw19', name: 'Gloves', when: c => c.cold, wt: c => 0.1 * ppl(c) },
    ],
  },
  {
    id: 'kids',
    title: "Kids' Pack",
    blurb: 'Boredom is the enemy of a good camp.',
    icon: Baby,
    tint: 'ochre',
    only: c => c.kids > 0,
    items: [
      { id: 'k01', name: 'Books', wt: 0.5 },
      { id: 'k02', name: 'Card / board games', wt: 0.5 },
      { id: 'k03', name: 'Colouring + textas', wt: 0.4 },
      { id: 'k04', name: 'Toys (small, curated)', wt: 1 },
      { id: 'k05', name: 'Bike / scooter', wt: 8 },
      { id: 'k06', name: 'Sand toys', wt: 0.5 },
      { id: 'k07', name: 'Comfort blanket / toy', wt: 0.3 },
      { id: 'k08', name: 'Special snacks (the bribery shelf)', wt: 0.5 },
      { id: 'k09', name: 'Tablet + headphones + downloaded shows', wt: 0.7 },
      { id: 'k10', name: 'Spare clothes — double the count', wt: c => 2 * Math.max(1, c.kids) },
      { id: 'k11', name: "Kid's first aid — paracetamol drops, plasters", wt: 0.3 },
      { id: 'k12', name: 'Lifejacket (if near water)', wt: 0.7 },
    ],
  },
  {
    id: 'recovery',
    title: 'Vehicle Recovery & Spares',
    blurb: 'For 4WD and caravan rigs heading off the bitumen.',
    icon: Truck,
    tint: 'rust',
    only: c => c.fourwd || c.setup === 'caravan' || c.setup === 'camper' || c.remote,
    items: [
      { id: 'r01', name: 'Recovery tracks (Maxtrax or similar)', wt: 15 },
      { id: 'r02', name: 'Snatch strap + tree-trunk protector', wt: 3 },
      { id: 'r03', name: 'Rated bow shackles', wt: 0.8 },
      { id: 'r04', name: 'Tyre deflators', wt: 0.2 },
      { id: 'r05', name: '12V air compressor + hose', wt: 5 },
      { id: 'r06', name: 'Tyre pressure gauge', wt: 0.2 },
      { id: 'r07', name: 'High-lift / bottle jack + base', wt: 5 },
      { id: 'r08', name: 'Wheel brace', wt: 1 },
      { id: 'r09', name: 'Spare tyre — pressure checked', wt: 30 },
      { id: 'r10', name: 'Jumper leads or jump pack', wt: 1.5 },
      { id: 'r11', name: 'Wheel chocks', wt: 1 },
      { id: 'r12', name: 'Levelling ramps / blocks', wt: 3 },
      { id: 'r13', name: 'Spare fuses + globes', wt: 0.2 },
      { id: 'r14', name: 'Engine oil top-up + coolant', wt: 5 },
      { id: 'r15', name: 'Radiator hose tape', wt: 0.1 },
    ],
  },
  {
    id: 'comms',
    title: 'Navigation & Comms',
    blurb: 'Paper map backup. Always. Phones die.',
    icon: Radio,
    tint: 'forest',
    items: [
      { id: 'n01', name: 'UHF radio (handheld)', wt: 0.5 },
      { id: 'n02', name: 'Satellite messenger — inReach / Zoleo', when: c => c.remote, wt: 0.2 },
      { id: 'n03', name: 'PLB — Personal Locator Beacon', when: c => c.remote, wt: 0.2 },
      { id: 'n04', name: 'Hema maps / road atlas', wt: 1.5 },
      { id: 'n05', name: 'Offline maps downloaded (Google / Maps.me)', wt: 0 },
      { id: 'n06', name: 'Compass', wt: 0.1 },
      { id: 'n07', name: 'Trip plan left with someone at home', when: c => c.remote, wt: 0 },
    ],
  },
  {
    id: 'play',
    title: 'Activities & Comfort',
    blurb: 'Camp chairs, cards, the rod by the door.',
    icon: Compass,
    tint: 'sky',
    items: [
      { id: 'pl01', name: 'Folding chairs', qty: c => `${ppl(c)}` },
      { id: 'pl02', name: 'Side table', wt: 4 },
      { id: 'pl03', name: 'Cards', wt: 0.1 },
      { id: 'pl04', name: 'Board games', wt: 1 },
      { id: 'pl05', name: 'Frisbee', wt: 0.2 },
      { id: 'pl06', name: 'Football / ball', wt: 0.4 },
      { id: 'pl07', name: 'Fishing rod + tackle', when: c => c.fishing, wt: 2 },
      { id: 'pl08', name: 'Bait + lures', when: c => c.fishing, wt: 0.3 },
      { id: 'pl09', name: 'Filleting knife + board', when: c => c.fishing, wt: 0.5 },
      { id: 'pl10', name: 'Snorkel + mask + fins', wt: 1.5 },
      { id: 'pl11', name: 'Binoculars', wt: 0.5 },
      { id: 'pl12', name: 'Camera / GoPro + spare cards', wt: 0.6 },
      { id: 'pl13', name: 'Book / Kindle', wt: 0.4 },
      { id: 'pl14', name: 'Notebook + pen', wt: 0.2 },
      { id: 'pl15', name: 'Firewood + kindling + newspaper', when: c => c.fire, wt: 10 },
    ],
  },

  // ==================================================================
  //  THE CANNING STOCK ROUTE — expedition specifics
  //  ~1,850 km, Wiluna → Halls Creek, Great Sandy & Gibson Deserts.
  //  This section only appears when CSR mode is engaged.
  // ==================================================================
  {
    id: 'csr',
    title: 'The Canning Stock Route',
    blurb: '1,850 km of dunes, wells and dust. The list that keeps you alive between them.',
    icon: Compass,
    tint: 'rust',
    only: c => c.csr,
    items: [
      // ---- Permits & planning (the bit most people leave too late) ----
      { id: 'csr01', name: 'Martu permit (Western Desert Lands Aboriginal Corp)', wt: 0.05 },
      { id: 'csr02', name: 'Birriliburu permit', wt: 0.05 },
      { id: 'csr03', name: 'Ngurrara permit', wt: 0.05 },
      { id: 'csr04', name: 'Karlamilyi National Park entry / fees', wt: 0.05 },
      { id: 'csr05', name: 'Kunawarritji (Well 33) fuel cache booked + paid', wt: 0 },
      { id: 'csr06', name: 'Trip plan filed with two contacts at home', wt: 0 },
      { id: 'csr07', name: 'Cash AUD for community fuel + permits (~$2k)', wt: 0.3 },
      { id: 'csr08', name: 'Convoy plan agreed — vehicles, frequencies, daily check-ins', wt: 0 },
      { id: 'csr09', name: 'Hema Canning Stock Route atlas', wt: 0.8 },
      { id: 'csr10', name: 'Paper map backup (laminated)', wt: 0.2 },
      { id: 'csr11', name: 'GPS waypoints — wells, fuel points, exits', wt: 0 },

      // ---- Fuel strategy ----
      { id: 'csr12', name: 'Total fuel planned for run', qty: Q.fuel, wt: c => Math.round((c.fuelL || 700) * 0.84) },
      { id: 'csr13', name: 'Long-range or sub-tank checked + full', wt: 0 },
      { id: 'csr14', name: 'Jerry cans (20L)', qty: Q.jerries, wt: c => Math.max(4, Math.ceil(((c.fuelL || 700) - 140) / 20)) * 1.8 },
      { id: 'csr15', name: 'Fuel transfer pump / siphon', wt: 1 },
      { id: 'csr16', name: 'Fuel funnel + filter (Mr Funnel or similar)', wt: 0.3 },
      { id: 'csr17', name: 'Spare fuel filter (×2 for the vehicle)', wt: 0.2 },

      // ---- Water for the desert ----
      { id: 'csr18', name: 'Vehicle water tank — clean, full', wt: 0 },
      { id: 'csr19', name: 'Water jerries — desert minimum', wt: 5 },
      { id: 'csr20', name: 'Emergency water bladder (sealed, untouched)', wt: 10 },
      { id: 'csr21', name: 'Water purification tabs / filter', wt: 0.1 },

      // ---- Tyres & wheels (the most-asked-about CSR topic) ----
      { id: 'csr22', name: 'Two spare tyres minimum — pressure checked', wt: 30 },
      { id: 'csr23', name: 'Tyre plug kit (heavy duty)', wt: 0.5 },
      { id: 'csr24', name: 'Sidewall repair patches', wt: 0.2 },
      { id: 'csr25', name: 'Tube repair kit + spare tube (one per tyre size)', wt: 1.5 },
      { id: 'csr26', name: 'Bead breaker', wt: 3 },
      { id: 'csr27', name: 'Tyre levers (×3)', wt: 0.8 },
      { id: 'csr28', name: 'Heavy-duty 12V compressor (ARB twin or similar)', wt: 7 },
      { id: 'csr29', name: 'Two tyre pressure gauges', wt: 0.3 },
      { id: 'csr30', name: 'Spare valve cores + tool', wt: 0.1 },

      // ---- Sand recovery ----
      { id: 'csr31', name: 'Maxtrax — full set', qty: Q.maxtrax, wt: 15 },
      { id: 'csr32', name: 'Long-handled shovel', wt: 2 },
      { id: 'csr33', name: 'Snatch strap + kinetic recovery rope', wt: 5 },
      { id: 'csr34', name: 'Tree-trunk protector + soft shackles', wt: 2 },
      { id: 'csr35', name: 'Rated bow shackles (×2)', wt: 1 },
      { id: 'csr36', name: 'Sand flag (mandatory across the dunes)', wt: 0.5 },
      { id: 'csr37', name: 'Recovery dampener / blanket', wt: 1.5 },

      // ---- Communications (non-negotiable) ----
      { id: 'csr38', name: 'HF radio with VKS-737 subscription, or…', wt: 5 },
      { id: 'csr39', name: 'Satellite phone (Iridium) or Starlink Mini', wt: 1.5 },
      { id: 'csr40', name: 'PLB — registered, in-date', wt: 0.2 },
      { id: 'csr41', name: 'UHF for convoy (vehicle + handheld)', wt: 0.5 },
      { id: 'csr42', name: 'Daily comms check window agreed with home', wt: 0 },

      // ---- Mechanical spares ----
      { id: 'csr43', name: 'Drive belts (alternator, AC, fan)', wt: 1 },
      { id: 'csr44', name: 'Radiator + heater hoses + clamps', wt: 1.5 },
      { id: 'csr45', name: 'Fuel pump (or rebuild kit)', wt: 1.5 },
      { id: 'csr46', name: 'Water pump', wt: 2 },
      { id: 'csr47', name: 'Wheel bearings (front + rear) + grease', wt: 1.5 },
      { id: 'csr48', name: 'CV joint (or boot kit)', wt: 3 },
      { id: 'csr49', name: 'Brake pads + brake fluid', wt: 1 },
      { id: 'csr50', name: 'Engine oil — 10 L spare + filter', wt: 10 },
      { id: 'csr51', name: 'Diff + transfer + gearbox oils', wt: 4 },
      { id: 'csr52', name: 'Coolant — 5 L concentrate', wt: 5 },
      { id: 'csr53', name: 'Power steering + clutch hydraulic fluid', wt: 1 },

      // ---- Tools ----
      { id: 'csr54', name: 'Full metric socket set + ratchet', wt: 6 },
      { id: 'csr55', name: 'Torque wrench', wt: 2 },
      { id: 'csr56', name: 'Spanner set (combination)', wt: 3 },
      { id: 'csr57', name: 'Multimeter', wt: 0.3 },
      { id: 'csr58', name: 'Hydraulic bottle jack + steel base plate', wt: 3 },
      { id: 'csr59', name: 'Hi-Lift jack + sand base', wt: 14 },
      { id: 'csr60', name: 'Allen + Torx keys', wt: 0.5 },
      { id: 'csr61', name: 'Hose clamps (assorted)', wt: 0.3 },
      { id: 'csr62', name: 'Self-amalgamating tape + Loctite', wt: 0.3 },
      { id: 'csr63', name: 'Workshop manual (paper, for your vehicle)', wt: 0.7 },

      // ---- Vehicle setup confirmations ----
      { id: 'csr64', name: 'Snorkel sealed + airbox clean', wt: 0 },
      { id: 'csr65', name: 'Cabin dust seal kit fitted', wt: 0 },
      { id: 'csr66', name: 'Bash plates / sump guard installed', wt: 0 },
      { id: 'csr67', name: 'Diff breathers extended above water line', wt: 0 },
      { id: 'csr68', name: 'Dual battery + DC-DC charger working', wt: 0 },
      { id: 'csr69', name: 'Solar (folding or fixed) tested', wt: 0 },
      { id: 'csr70', name: 'Rated recovery points front + rear', wt: 0 },
      { id: 'csr71', name: 'GVM + payload audited (BootKamp calc)', wt: 0 },

      // ---- Desert living ----
      { id: 'csr72', name: 'Heavy-duty bin bags — pack everything out', wt: 0.5 },
      { id: 'csr73', name: 'Industrial wet wipes (water is for drinking)', wt: 1 },
      { id: 'csr74', name: 'Dust covers / dry bags for electronics + bedding', wt: 0.5 },
      { id: 'csr75', name: 'Compressed firewood (no foraging on country)', wt: 15 },
      { id: 'csr76', name: 'Insect head net (×per person)', wt: c => 0.1 * ppl(c) },
      { id: 'csr77', name: 'Salt tablets / electrolytes (heavy)', wt: 0.3 },
      { id: 'csr78', name: 'Cathole trowel (Leave No Trace, always)', wt: 0.3 },

      // ---- Medical (above standard first aid) ----
      { id: 'csr79', name: 'Trauma kit — splint, sling, large dressings', wt: 3 },
      { id: 'csr80', name: 'Compression bandages ×4 (snake bite redundancy)', wt: 0.4 },
      { id: 'csr81', name: 'Burn dressing (Burnaid or similar)', wt: 0.2 },
      { id: 'csr82', name: 'Eye wash + saline (dust country)', wt: 0.3 },
      { id: 'csr83', name: 'Personal scripts — named, 2× supply', wt: 0.2 },
      { id: 'csr84', name: 'Evac contact list — RFDS, insurer, family', wt: 0 },
    ],
  },

  {
    id: 'walkaround',
    title: 'Final walk-around (before pulling out)',
    blurb: 'The last five minutes save you forty.',
    icon: ClipboardCheck,
    tint: 'ink',
    items: [
      { id: 'wa01', name: 'Bin emptied + carried out' },
      { id: 'wa02', name: 'Gas turned off at the bottle' },
      { id: 'wa03', name: 'Fridge door propped open if leaving van' },
      { id: 'wa04', name: 'Water tanks topped or drained' },
      { id: 'wa05', name: 'Solar + batteries armed for travel' },
      { id: 'wa06', name: 'Walk the site — no rubbish, no gear left' },
      { id: 'wa07', name: 'Photo of campsite condition' },
      { id: 'wa08', name: 'Trip log / fuel log updated' },
      { id: 'wa09', name: 'Pegs counted, mallet on board' },
    ],
  },
];

// =====================================================================
//  TRIP BLUEPRINTS
//  Curated archetypes drawn from real-world packing lists and trip
//  reports — Hema Maps, Snowys, We Are Explorers, 4WD Adventurer,
//  Tracks 4x4 Tagalong, Rhino-Rack interviews with Dan Grec, and
//  community wisdom from CSR / Simpson / Cape York forums.
//  Each blueprint configures the trip profile and shows three lists:
//    essentials → don't leave home without
//    luxuries   → if weight allows, your trip is better with these
//    weightSavers → practical tips to shave kilograms
// =====================================================================
const TRIP_BLUEPRINTS = [
  {
    id: 'bp-day',
    title: 'Day trip with the family',
    tagline: 'Out by nine, home before bath time. The art of the half-day adventure.',
    icon: Sun,
    tint: 'sky',
    stats: [
      ['1 day',      'duration'],
      ['50–150 km',  'typical loop'],
      ['4 L',        'water / adult'],
    ],
    config: { adults: 2, kids: 2, nights: 1, setup: 'tent', fire: false, fourwd: false, remote: false, cold: false, fishing: false, csr: false, fuelL: 0 },
    essentials: [
      'Reusable water bottles — one per person plus a spare',
      'Sunscreen SPF50+ and a broad-brim hat each',
      'Picnic blanket or ground rug',
      'Soft-sided esky with ice',
      'Wet wipes and hand sanitiser',
      'Pocket first aid — plasters, ibuprofen, antihistamine, snake bite bandage',
      'Insect repellent (DEET 20% for general bushland)',
      'Toilet paper and a small trowel for emergencies',
      'A complete spare outfit for each child (always)',
      'Offline map or Hema app downloaded before you leave',
      'Cash for park entry, ice creams and roadhouse stops',
      'Phone in a zip-lock bag (waterproofing for $0.10)',
    ],
    luxuries: [
      'Lightweight folding chairs so you can actually relax',
      'A hammock for the long lunch',
      'Frisbee, soccer ball, or a kite',
      'Pour-over coffee kit and a thermos',
      'Real plates and cutlery instead of disposables',
      'Compact bluetooth speaker — low volume, mind the bush',
    ],
    weightSavers: [
      'Skip cookware — sandwiches, fruit and cheese travel fine in an esky.',
      'A blanket on the ground replaces a folding table.',
      'Refill bottles at park taps where signed safe to drink.',
      'One shared family esky, not three individual day-packs.',
      'Wear your bulkiest layer instead of carrying it.',
    ],
  },

  {
    id: 'bp-boys',
    title: 'Weekend camping with the boys',
    tagline: 'Three swags, a fire pit, and not enough firewood. The classic.',
    icon: Beer,
    tint: 'ochre',
    stats: [
      ['2 nights',    'duration'],
      ['200–600 km',  'typical drive'],
      ['1 esky',      'of beer (mandatory)'],
    ],
    config: { adults: 4, kids: 0, nights: 2, setup: 'swag', fire: true, fourwd: false, remote: false, cold: false, fishing: true, csr: false, fuelL: 0 },
    essentials: [
      'Swag or simple tent (one each — no shared bunks)',
      'Sleeping bag rated five degrees colder than the forecast',
      'Inflatable mat or canvas stretcher',
      'Camp chair — the comfortable one, not the cheap one',
      'Headlamp + spare batteries',
      'Firewood, kindling and firelighters',
      'BBQ plate or fire grill',
      'Tongs, spatula, tea towel',
      'Two eskies — one beer, one food (do not mix)',
      '10 kg of ice minimum, more if hot',
      'Plate, enamel cup, knife and fork each',
      'Sharp knife and a small cutting board',
      'Basic first aid + snake bite bandages',
      'Sunscreen, insect repellent, toilet roll, trowel',
      'UHF handheld if heading anywhere remote',
      'Cards or dominoes',
    ],
    luxuries: [
      'Camp oven for Sunday breakfast or a slow lamb shank stew',
      'Bluetooth speaker (and a courtesy off-time)',
      'Marinated meats prepped at home in zip-locks',
      'Folding side table for poker night',
      'Real glasses or proper enamel mugs',
      'A spare swag in case someone rocks up',
      'Hammock for the Sunday hangover',
      'Hot water for a billy coffee at sunrise',
    ],
    weightSavers: [
      'Pre-marinate meat at home — no carrying jars of sauce.',
      'One big pot beats three small ones.',
      'Skip the gas stove if the fire is on — coals do everything.',
      'Share one esky between four people and refill ice mid-trip.',
      'Cardboard plates plus reusable cutlery beats stacks of crockery.',
      'BYO firewood from town; never forage in a national park.',
    ],
  },

  {
    id: 'bp-simpson',
    title: 'Solo Simpson Desert crossing',
    tagline: '1,136 dunes. Forty hours of low range. Every kilo is a fuel kilo.',
    icon: Compass,
    tint: 'rust',
    stats: [
      ['5–10 days',   'recommended'],
      ['430–700 km',  'depending on route'],
      ['7 L / day',   'water per person'],
      ['200+ L',      'fuel (sand uses 50% more)'],
    ],
    config: { adults: 1, kids: 0, nights: 7, setup: 'swag', fire: true, fourwd: true, remote: true, cold: true, fishing: false, csr: false, fuelL: 200 },
    essentials: [
      'Desert Parks Pass — book online before leaving home',
      '2.9 m fluorescent sand flag (mandatory on every dune crossing)',
      'Sat phone (hire from Mt Dare, drop at Birdsville) or HF radio',
      'PLB, registered and in date',
      'UHF radio in vehicle + handheld backup',
      'Long-range fuel tank plus 2 × 20 L jerries minimum',
      'Fuel funnel + filter (Mr Funnel or equivalent)',
      '7 L of water per person per day, plus four days emergency reserve',
      'Tyre repair kit — plugs, sidewall patches, tubes',
      'Bead breaker, tyre levers, valve cores',
      'Heavy-duty 12 V compressor (you will deflate to 18–20 psi)',
      'Maxtrax and a long-handled shovel',
      'Snatch strap, rated bow shackles, tree-trunk protector',
      'Mechanical spares: belts, hoses, fuel filter, fuses',
      'Fluids: engine oil, diff oil, brake fluid, coolant top-up',
      'Fire extinguisher and fire blanket',
      'Sleeping bag rated to 0°C — winter desert is freezing at night',
      'Warm jacket, beanie, thermals — pack like alpine in July',
      'Fly nets for every person (DEET does not work on bush flies)',
      'Hema Simpson Desert Atlas + paper map backup',
      'Trip plan filed in writing with two contacts at home',
    ],
    luxuries: [
      'Roof-top tent for fast set-up after a brutal driving day',
      'Quality espresso pot for fire-side mornings',
      'Camera kit — GoPro for dune crests, real camera for the silence',
      'Folding chair plus a small fire stool',
      'Ecologs or compressed firewood from Oodnadatta',
      'A single decent steak vacuum-packed for night four',
      'Small inverter for laptop / camera charging',
      'Hot shower bag for a sponge-down after the dunes',
    ],
    weightSavers: [
      'Pack four days of meals plus emergency reserve, not seven full days — most crossings finish faster than expected.',
      'One cast-iron skillet and a billy replace the entire kitchen.',
      'Decant pantry into zip-locks — boxes are dead weight.',
      'Wear your heaviest layer in the car, pack one spare set.',
      'Eat at Mt Dare and Birdsville pubs at either end — saves a day of food and fuel mass.',
      'Lower fuel mass = better fuel economy = even less fuel needed. Audit ruthlessly.',
      'Hire the sat phone, don\'t buy one for a single trip.',
    ],
    sourceNote: 'Sourced from Hema Maps Simpson Desert guide, Dan Grec via Rhino-Rack, Snowys 3-part series, Trekking Down Under, We Are Explorers.',
  },

  {
    id: 'bp-cape',
    title: 'Cape York in three weeks',
    tagline: 'Cairns to the Tip and back, via every creek crossing on the Old Telegraph Track.',
    icon: MapPin,
    tint: 'forest',
    stats: [
      ['21 days',     'comfortable family pace'],
      ['~2,000 km',   'return from Cairns'],
      ['Dry season',  'May to October only'],
      ['~$2.20/L+',   'fuel at the Tip'],
    ],
    config: { adults: 2, kids: 2, nights: 21, setup: 'camper', fire: true, fourwd: true, remote: false, cold: false, fishing: true, csr: false, fuelL: 0 },
    essentials: [
      'Snorkel and extended diff + gearbox breathers (creek crossings are deep)',
      'Bull bar for the wandering pigs and big roos at dusk',
      '33-inch all-terrain tyres if attempting the Old Telegraph Track',
      'Recovery kit: Maxtrax, snatch strap, rated shackles, winch or convoy buddy',
      'Long-handled shovel',
      'Tyre repair kit + heavy-duty compressor',
      '12 V fridge with dual battery and DC-DC charger',
      'Cargo barrier (corrugations will throw your gear at your head)',
      'UHF radio (no phone service past Cooktown)',
      'Hema Cape York Atlas',
      'Cash for the Jardine ferry, permits, and remote fuel stops',
      'Heavy-duty insect repellent (DEET 80%+ for sand flies and march flies)',
      'Mosquito net for sleeping in tropical heat',
      'Long-sleeve sun shirt (UPF 50+) and a wide-brim hat with neck flap',
      'Crocodile awareness: never camp within 50 m of any water',
      'Comprehensive first aid + snake bite + antibiotics from your GP',
      'Spare belts, hoses, fuses, fuel filter',
      '240V inverter for three weeks of devices',
      'Quality torch + spare batteries (the dark up here is dark)',
      'Bramwell Junction Roadhouse fuel-up before the Tele Track',
    ],
    luxuries: [
      'Awning plus annex walls for tropical downpours',
      'Outdoor mat to keep the red dust outside',
      'Hot water shower — gravity or pump fed',
      'Camp oven for a slow cook at Chili Beach',
      'A real pillow that isn\'t a rolled-up jumper',
      'Drone (check restricted airspace — much of the Cape is banned)',
      'Hammock for Fruit Bat Falls and Eliot Falls afternoons',
      'A pub-meals fund — Bramwell, Musgrave, Archer River, Seisia all serve hot food',
      'Esky for fresh produce restocked at IGA Bamaga',
    ],
    weightSavers: [
      'Restock food at Coen, Weipa, or Bamaga IGA — don\'t carry three weeks of fresh from Cairns.',
      'Skip a second spare if you carry a plug kit, compressor and have a convoy buddy.',
      'Five outfits and a Weipa laundry stop replaces 21 sets of clothes.',
      'Use station camps with showers rather than carrying a 20 L shower tank.',
      'Buy firewood at roadhouses — don\'t haul it from Cairns.',
      'One creek crossing per day washes you and most of your clothes.',
      'Alcohol restrictions apply in many Cape communities — check before you load the esky.',
    ],
    sourceNote: 'Sourced from Hema Maps Cape York guide, Unsealed 4X4 Cape York adventure guide, Travel NQ, The Vanabond Tales, Tracks 4x4 Tagalong.',
  },

  {
    id: 'bp-csr',
    title: 'Canning Stock Route convoy',
    tagline: 'Two cars, 1,850 km, every well from Wiluna to Halls Creek.',
    icon: Truck,
    tint: 'ink',
    stats: [
      ['3 weeks',      'minimum'],
      ['1,850 km',     'Wiluna → Halls Creek'],
      ['10 L / day',   'water per person'],
      ['600–800 L',    'fuel per vehicle'],
      ['2 vehicles',   'minimum, always'],
    ],
    config: { adults: 2, kids: 0, nights: 21, setup: 'tent', fire: true, fourwd: true, remote: true, cold: true, fishing: false, csr: true, fuelL: 700 },
    essentials: [
      'Convoy plan agreed: lead and sweep order, UHF channel, daily rendezvous point',
      'Fuel cache at Kunawarritji (Well 33) booked and paid in advance',
      'Vehicle-to-vehicle radio etiquette — call dunes, hazards, photo stops',
      'Shared spares register — split belts, hoses, pumps, filters across both rigs',
      'Sat phone or Starlink Mini per vehicle (don\'t double up on one car)',
      'PLB per vehicle, registered and in date',
      'Sand flag fitted to every vehicle',
      'Trip plan filed in writing with a contact at home',
      'Cash ~$2,000+ per vehicle for community fuel and permits',
      'Permits: Martu, Birriliburu, Ngurrara, and Karlamilyi NP fees',
      'Compressed firewood — no foraging on country',
      'Daily comms check window agreed with home',
      'Spare keys cross-stored in the other vehicle',
      'Two compression bandages per person (snake bite redundancy)',
      'Heavy-duty 12 V compressor in each rig',
      'Two spare tyres per vehicle (one mounted, one carried)',
    ],
    luxuries: [
      'Camp oven for a long potjie at Well 23',
      'Folding shower + privacy tent shared between the vehicles',
      'Espresso kit for the morning convoy briefing',
      'Drone (avoid culturally restricted areas — check ahead)',
      'A binoculars and a star chart for the silent nights',
      'Camp chairs that recline — you\'ll be in them often',
      'One bottle of decent whisky shared at the end of the run',
      'A rest day at Durba Springs — bring a book',
    ],
    weightSavers: [
      'Split heavy gear across vehicles: tools in one, spares in the other.',
      'One satellite charger between two cars, not one per car.',
      'Decant fuel from drums at Well 33 — don\'t carry the full 1,850 km of fuel.',
      'Skip a second fridge per vehicle — one large unit feeds two crews.',
      'Buy supplies at Wiluna, not Perth — saves a week of food carriage on the drive in.',
      'Lead vehicle carries recovery gear; sweep vehicle carries mechanical spares.',
      'Coordinate meals across vehicles — each cooks every second night, halves the stove fuel per crew.',
    ],
    sourceNote: 'Sourced from CSR community forums, Hema CSR Atlas guidance, BootKamp field notes, and convoy planning frameworks used by experienced WA expedition leaders.',
  },
];

// =====================================================================
//  STORAGE
// =====================================================================
async function loadState() {
  try {
    if (typeof window === 'undefined' || !window.storage) return null;
    const res = await window.storage.get(STORAGE_KEY);
    return res ? JSON.parse(res.value) : null;
  } catch (e) { return null; }
}
async function saveState(state) {
  try {
    if (typeof window === 'undefined' || !window.storage) return;
    await window.storage.set(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

// =====================================================================
//  THEME / DECOR
// =====================================================================
const tintFor = (k) => ({
  forest: { bg: C.forestLt, fg: C.forest, dark: C.forestDk },
  rust:   { bg: C.rustLt,   fg: C.rust,   dark: C.rustDk },
  ochre:  { bg: C.ochreLt,  fg: C.ochre,  dark: C.rustDk },
  sky:    { bg: '#D9E2E8',  fg: C.sky,    dark: '#243743' },
  ink:    { bg: '#E2DBC9',  fg: C.ink2,   dark: C.ink },
}[k] || { bg: C.forestLt, fg: C.forest, dark: C.forestDk });

// Topographic background pattern
const TopoBg = () => (
  <svg
    aria-hidden="true"
    style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.12, zIndex: 0 }}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <pattern id="topo" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
        <path d="M 0 110 Q 55 60 110 110 T 220 110" fill="none" stroke={C.rust} strokeWidth="0.8"/>
        <path d="M 0 140 Q 55 95 110 140 T 220 140" fill="none" stroke={C.rust} strokeWidth="0.6"/>
        <path d="M 0 80 Q 55 30 110 80 T 220 80" fill="none" stroke={C.rust} strokeWidth="0.5"/>
        <path d="M 0 170 Q 55 130 110 170 T 220 170" fill="none" stroke={C.rust} strokeWidth="0.4"/>
        <path d="M 0 50 Q 55 5 110 50 T 220 50" fill="none" stroke={C.rust} strokeWidth="0.3"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#topo)" />
  </svg>
);

// =====================================================================
//  MAIN COMPONENT
// =====================================================================
export default function FieldManifest() {
  const [config, setConfig] = useState(DEFAULTS);
  const [checked, setChecked] = useState({});      // {itemId: true}
  const [hidden, setHidden] = useState({});        // {itemId: true} – user-removed defaults
  const [custom, setCustom] = useState({});        // {catId: [{id,name,qty}]}
  const [open, setOpen] = useState({});            // {catId: true} – which categories expanded
  const [filter, setFilter] = useState('all');     // all | todo | done
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [emailSaved, setEmailSaved] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [toast, setToast] = useState('');

  // ---- Tab & Trip state ----
  const [tab, setTab] = useState('pack');                 // 'pack' | 'payload' | 'blueprints' | 'fuel' | 'journal'
  const [tripName, setTripName] = useState('Current trip');
  const [fuelEntries, setFuelEntries] = useState([]);     // [{id, date, location, odo, litres, pricePerL, totalCost}]
  const [journalEntries, setJournalEntries] = useState([]); // [{id, date, location, kmTravelled, lat, lng, reflection, weather}]
  const [crewTrip, setCrewTrip] = useState(null);         // {id, name} — active shared trip
  const loaded = useRef(false);

  // Load persisted state once
  useEffect(() => {
    (async () => {
      const s = await loadState();
      if (s) {
        if (s.config) setConfig({ ...DEFAULTS, ...s.config });
        if (s.checked) setChecked(s.checked);
        if (s.hidden) setHidden(s.hidden);
        if (s.custom) setCustom(s.custom);
        if (s.open) setOpen(s.open);
        if (s.email) { setEmail(s.email); setEmailSaved(true); }
        if (s.tab) setTab(s.tab);
        if (s.tripName) setTripName(s.tripName);
        if (Array.isArray(s.fuelEntries)) setFuelEntries(s.fuelEntries);
        if (Array.isArray(s.journalEntries)) setJournalEntries(s.journalEntries);
        if (s.crewTrip) setCrewTrip(s.crewTrip);
      } else {
        // first run — open the first three categories
        setOpen({ admin: true, water: true, pantry: true });
      }
      loaded.current = true;
    })();
  }, []);

  // Persist on changes
  useEffect(() => {
    if (!loaded.current) return;
    saveState({
      config, checked, hidden, custom, open,
      email: emailSaved ? email : '',
      tab, tripName,
      fuelEntries, journalEntries, crewTrip,
    });
  }, [config, checked, hidden, custom, open, email, emailSaved, tab, tripName, journalEntries, crewTrip]);

  // Toast helper
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1800); };

  // Build the working list per category given config + filters
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATEGORIES
      .filter(cat => !cat.only || cat.only(config))
      .map(cat => {
        const base = cat.items
          .filter(it => !hidden[it.id])
          .filter(it => !it.when || it.when(config));
        const extras = (custom[cat.id] || []);
        const all = [...base, ...extras];
        const items = all.filter(it => {
          if (q && !it.name.toLowerCase().includes(q)) return false;
          if (filter === 'todo' && checked[it.id]) return false;
          if (filter === 'done' && !checked[it.id]) return false;
          return true;
        });
        return { ...cat, items, totalCount: all.length, doneCount: all.filter(i => checked[i.id]).length };
      });
  }, [config, checked, hidden, custom, search, filter]);

  const grandTotal = visible.reduce((a, c) => a + c.totalCount, 0);
  const grandDone  = visible.reduce((a, c) => a + c.doneCount, 0);
  const pct = grandTotal ? Math.round((grandDone / grandTotal) * 100) : 0;

  // ----- handlers -----
  const toggleItem = (id) => setChecked(p => ({ ...p, [id]: !p[id] }));
  const removeItem = (id) => {
    setHidden(p => ({ ...p, [id]: true }));
    setChecked(p => { const n = { ...p }; delete n[id]; return n; });
  };
  const removeCustom = (catId, id) => {
    setCustom(p => ({ ...p, [catId]: (p[catId] || []).filter(i => i.id !== id) }));
    setChecked(p => { const n = { ...p }; delete n[id]; return n; });
  };
  const addCustom = (catId, name) => {
    if (!name.trim()) return;
    const id = `u-${catId}-${Date.now()}`;
    setCustom(p => ({ ...p, [catId]: [...(p[catId] || []), { id, name: name.trim() }] }));
  };
  const resetAll = () => {
    if (!confirm('Clear all ticks, custom items, and removed items? Your trip profile stays.')) return;
    setChecked({}); setHidden({}); setCustom({});
    flash('Reset.');
  };
  const toggleCat = (id) => setOpen(p => ({ ...p, [id]: !p[id] }));
  const expandAll = () => setOpen(Object.fromEntries(CATEGORIES.map(c => [c.id, true])));
  const collapseAll = () => setOpen({});

  // Export
  const exportText = () => {
    const lines = [];
    lines.push('THE FIELD MANIFEST');
    lines.push('─────────────────────────────────');
    lines.push(`Adults: ${config.adults}   Kids: ${config.kids}   Nights: ${config.nights}`);
    lines.push(`Setup: ${config.setup}${config.fourwd ? ' · 4WD' : ''}${config.remote ? ' · remote' : ''}${config.cold ? ' · cold' : ''}${config.fishing ? ' · fishing' : ''}${config.fire ? ' · campfire' : ''}`);
    lines.push(`Progress: ${grandDone}/${grandTotal}  (${pct}%)`);
    lines.push('');
    visible.forEach(cat => {
      const all = [
        ...cat.items.filter(i => !i.id.startsWith('u-')),
        ...(custom[cat.id] || []),
      ];
      if (!all.length) return;
      lines.push(`# ${cat.title.toUpperCase()}`);
      cat.items.concat(custom[cat.id] || []).forEach(it => {
        const tick = checked[it.id] ? '[x]' : '[ ]';
        const q = it.qty ? `  — ${it.qty(config)}` : '';
        lines.push(`${tick} ${it.name}${q}`);
      });
      lines.push('');
    });
    return lines.join('\n');
  };

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(exportText());
      flash('Copied to clipboard.');
    } catch (e) { flash('Copy failed.'); }
  };

  const downloadList = () => {
    const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `field-manifest_${config.nights}n_${config.adults}a${config.kids}k.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash('Downloaded.');
  };

  const submitEmail = () => {
    if (!email.includes('@') || !email.includes('.')) { flash('Enter a valid email.'); return; }
    setEmailSaved(true);
    flash('Saved — your PDF & tips are on the way.');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.ink,
        fontFamily: '"Inter Tight", system-ui, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .fr { font-family: 'Fraunces', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        button { font-family: inherit; cursor: pointer; }
        input, button { font-family: inherit; color: inherit; }
        ::selection { background: ${C.rust}33; }
        .lift { transition: transform .15s ease, box-shadow .15s ease; }
        .lift:active { transform: translateY(1px); }
        .grow-in { animation: gi .35s ease both; }
        @keyframes gi { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
        .pulse { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
      `}</style>

      <TopoBg />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 880, margin: '0 auto', padding: '24px 18px 140px' }}>

        {/* ============= MASTHEAD ============= */}
        <header style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: C.ink, color: C.bg,
              display: 'grid', placeItems: 'center',
              fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: 14,
            }}>FM</div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase' }}>
              No. 01 · Living edition
            </div>
          </div>
          <h1 className="fr" style={{
            fontWeight: 600, fontSize: 'clamp(36px, 8vw, 56px)',
            lineHeight: 0.95, letterSpacing: '-0.02em', margin: '4px 0 8px',
          }}>
            The Field
            <span style={{ fontStyle: 'italic', color: C.rust }}> Manifest</span>
          </h1>
          <p className="fr" style={{ fontStyle: 'italic', fontSize: 17, color: C.ink2, margin: 0, maxWidth: 560, lineHeight: 1.35 }}>
            A living packing list for weekend escapes to the big lap. Tell it about your trip — it calculates the rest.
          </p>
          <div style={{ height: 1, background: C.rule, margin: '18px 0 0' }} />
        </header>

        {/* ============= TAB BAR ============= */}
        <TabBar tab={tab} setTab={setTab} journalCount={journalEntries.length} hasCrewTrip={!!crewTrip}/>

        {tab === 'pack' && (<>

        {/* ============= TRIP BLUEPRINTS ============= */}
        <BlueprintSection
          currentConfig={config}
          onApply={(bp) => {
            setConfig({ ...DEFAULTS, ...bp.config });
            // gentle scroll cue — go to the trip profile so they can fine-tune
            setTimeout(() => {
              const el = document.querySelector('[data-anchor="profile"]');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
            flash(`Loaded: ${bp.title}`);
          }}
        />

        {/* ============= TRIP PROFILE ============= */}
        <section data-anchor="profile" style={{ background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase' }}>Trip profile</div>
              <div className="fr" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, marginTop: 2 }}>
                Tune this first
              </div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: C.muted, textAlign: 'right', lineHeight: 1.3 }}>
              Quantities adjust as you change<br/>this profile.
            </div>
          </div>

          {/* Numeric steppers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <Stepper label="Adults" value={config.adults} min={1} max={12}
                     onChange={v => setConfig(c => ({ ...c, adults: v }))} />
            <Stepper label="Kids" value={config.kids} min={0} max={10}
                     onChange={v => setConfig(c => ({ ...c, kids: v }))} />
            <Stepper label="Nights" value={config.nights} min={1} max={365}
                     onChange={v => setConfig(c => ({ ...c, nights: v }))} />
          </div>

          {/* Setup */}
          <div style={{ marginBottom: 14 }}>
            <Label>Setup</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['tent', 'Tent'],
                ['swag', 'Swag'],
                ['camper', 'Camper trailer'],
                ['caravan', 'Caravan / motorhome'],
              ].map(([v, l]) => (
                <Chip key={v} active={config.setup === v} onClick={() => setConfig(c => ({ ...c, setup: v }))}>{l}</Chip>
              ))}
            </div>
          </div>

          {/* Features */}
          <div>
            <Label>Trip features</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip active={config.fourwd}  onClick={() => setConfig(c => ({ ...c, fourwd: !c.fourwd }))}>4WD trip</Chip>
              <Chip active={config.remote}  onClick={() => setConfig(c => ({ ...c, remote: !c.remote }))}>Remote / off-grid</Chip>
              <Chip active={config.cold}    onClick={() => setConfig(c => ({ ...c, cold: !c.cold }))}>Cold weather</Chip>
              <Chip active={config.fire}    onClick={() => setConfig(c => ({ ...c, fire: !c.fire }))}>Campfire</Chip>
              <Chip active={config.fishing} onClick={() => setConfig(c => ({ ...c, fishing: !c.fishing }))}>Fishing</Chip>
              <Chip active={config.csr}
                    onClick={() => setConfig(c => c.csr
                      ? { ...c, csr: false }
                      : { ...c, csr: true, fourwd: true, remote: true, fire: true })}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Compass size={11}/> Canning Stock Route
                </span>
              </Chip>
            </div>
          </div>

          {/* Profile presets */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${C.rule}`, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase', alignSelf: 'center' }}>Quick presets:</span>
            <Chip onClick={() => setConfig({ ...DEFAULTS, adults: 2, kids: 0, nights: 2, setup: 'tent', fire: true })}>Weekend warrior</Chip>
            <Chip onClick={() => setConfig({ ...DEFAULTS, adults: 2, kids: 1, nights: 7, setup: 'camper', fire: true })}>Family week</Chip>
            <Chip onClick={() => setConfig({ ...DEFAULTS, adults: 2, kids: 2, nights: 90, setup: 'caravan', fourwd: true, remote: true, fire: true })}>The big lap</Chip>
            <Chip onClick={() => setConfig({ ...DEFAULTS, adults: 2, kids: 0, nights: 21, setup: 'tent', fourwd: true, remote: true, fire: true, csr: true, fuelL: 700 })}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Compass size={11}/> Canning Stock Route
              </span>
            </Chip>
          </div>
        </section>

        {/* ============= PAYLOAD ESTIMATE + GVM CALCULATOR ============= */}
        <PayloadCard config={config} checked={checked} hidden={hidden} custom={custom} />

        {/* ============= STATS + CONTROLS ============= */}
        <section style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
            <div>
              <div className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase' }}>Progress</div>
              <div className="fr" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
                {grandDone}<span style={{ color: C.muted, fontWeight: 400 }}>/{grandTotal}</span>
                <span className="mono" style={{ fontSize: 14, marginLeft: 8, color: C.rust }}>{pct}%</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <IconBtn onClick={expandAll}    title="Expand all"><ChevronDown size={16}/></IconBtn>
              <IconBtn onClick={collapseAll}  title="Collapse all"><ChevronDown size={16} style={{ transform: 'rotate(180deg)' }}/></IconBtn>
              <IconBtn onClick={resetAll}     title="Reset progress"><RotateCcw size={16}/></IconBtn>
            </div>
          </div>

          {/* progress bar */}
          <div style={{ height: 6, background: C.paper2, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.rule}` }}>
            <div style={{ width: `${pct}%`, height: '100%', background: C.rust, transition: 'width .35s ease' }} />
          </div>

          {/* search + filter */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.muted }}/>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search anything…"
                style={{
                  width: '100%', padding: '10px 12px 10px 32px',
                  border: `1px solid ${C.rule}`, background: C.paper,
                  borderRadius: 10, fontSize: 14, outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 10, overflow: 'hidden' }}>
              {[
                ['all', 'All'],
                ['todo', 'To do'],
                ['done', 'Done'],
              ].map(([v, l]) => (
                <button key={v}
                        onClick={() => setFilter(v)}
                        className="mono"
                        style={{
                          padding: '0 12px', fontSize: 11, letterSpacing: 1.5,
                          background: filter === v ? C.ink : 'transparent',
                          color: filter === v ? C.bg : C.ink,
                          border: 'none', textTransform: 'uppercase', height: '100%',
                        }}>{l}</button>
              ))}
            </div>
          </div>
        </section>

        {/* ============= CATEGORIES ============= */}
        <main>
          {visible.map((cat, idx) => (
            <React.Fragment key={cat.id}>
              <CategoryCard
                cat={cat}
                isOpen={!!open[cat.id]}
                onToggle={() => toggleCat(cat.id)}
                checked={checked}
                config={config}
                toggleItem={toggleItem}
                removeItem={removeItem}
                removeCustom={(id) => removeCustom(cat.id, id)}
                addCustom={(name) => addCustom(cat.id, name)}
                customIds={new Set((custom[cat.id] || []).map(i => i.id))}
              />
              {idx === 2 && <EmailCapture
                email={email} setEmail={setEmail}
                saved={emailSaved} onSubmit={submitEmail}
              />}
            </React.Fragment>
          ))}
        </main>

        {/* ============= FOOTER NOTE ============= */}
        <footer style={{ marginTop: 36, paddingTop: 18, borderTop: `1px solid ${C.rule}` }}>
          <p className="fr" style={{ fontStyle: 'italic', color: C.muted, fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            “Pack what fits the place you're going, not what fits the car.”
          </p>
          <p className="mono" style={{ fontSize: 10, letterSpacing: 1.5, color: C.muted, marginTop: 10, textTransform: 'uppercase' }}>
            Your list saves automatically · {grandTotal} items across {visible.length} sections
          </p>
        </footer>

        </>)}

        {tab === 'journal' && (
          <JournalView
            tripName={tripName}
            setTripName={setTripName}
            entries={journalEntries}
            setEntries={setJournalEntries}
            flash={flash}
            config={config}
          />
        )}

        {tab === 'crew' && (
          <CrewView
            categories={visible}
            crewTrip={crewTrip}
            setCrewTrip={(t) => { setCrewTrip(t); }}
            flash={flash}
          />
        )}
      </div>

      {/* ============= STICKY EXPORT BAR ============= */}
      {tab === 'pack' && (
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        background: `linear-gradient(to top, ${C.bg} 60%, ${C.bg}00)`,
        padding: '18px 14px 16px', zIndex: 5,
      }}>
        <div style={{
          maxWidth: 880, margin: '0 auto',
          background: C.ink, color: C.bg,
          borderRadius: 14, padding: 10,
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 12px 30px -10px rgba(28, 24, 19, 0.45)',
        }}>
          <div style={{ flex: 1, paddingLeft: 6 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' }}>Manifest</div>
            <div className="fr" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1 }}>
              {grandDone} / {grandTotal} packed
            </div>
          </div>
          <button onClick={copyList} className="lift" title="Copy as checklist"
            style={{ background: 'transparent', color: C.bg, border: `1px solid ${C.bg}33`, borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Copy size={14}/> Copy
          </button>
          <button onClick={downloadList} className="lift" title="Download as text"
            style={{ background: C.rust, color: C.bg, border: 'none', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <Download size={14}/> Save list
          </button>
        </div>
      </div>
      )}

      {/* ============= TOAST ============= */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)',
          background: C.forest, color: C.bg, padding: '10px 16px',
          borderRadius: 999, fontSize: 13, zIndex: 10,
          boxShadow: '0 10px 25px -8px rgba(0,0,0,0.4)',
        }} className="grow-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// =====================================================================
//  CATEGORY CARD
// =====================================================================
function CategoryCard({ cat, isOpen, onToggle, checked, config, toggleItem, removeItem, removeCustom, addCustom, customIds }) {
  const t = tintFor(cat.tint);
  const Icon = cat.icon;
  const pct = cat.totalCount ? Math.round((cat.doneCount / cat.totalCount) * 100) : 0;
  const [newName, setNewName] = useState('');

  return (
    <section style={{
      background: C.paper, border: `1px solid ${C.rule}`,
      borderRadius: 14, marginBottom: 10, overflow: 'hidden',
    }}>
      <button onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
          padding: 14, display: 'flex', alignItems: 'center', gap: 12,
        }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: t.bg, color: t.dark, display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div className="fr" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>
              {cat.title}
            </div>
            <div className="mono" style={{ fontSize: 11, color: C.muted }}>
              {cat.doneCount}/{cat.totalCount}
            </div>
          </div>
          <div className="fr" style={{ fontStyle: 'italic', fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.3 }}>
            {cat.blurb}
          </div>
        </div>
        <ChevronDown size={18} style={{
          color: C.muted, transition: 'transform .2s ease',
          transform: isOpen ? 'rotate(180deg)' : 'none',
        }}/>
      </button>

      {/* mini progress */}
      <div style={{ height: 2, background: 'transparent', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, background: C.paper2 }} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: t.fg, transition: 'width .3s ease' }} />
      </div>

      {isOpen && (
        <div className="grow-in" style={{ padding: '6px 8px 10px' }}>
          {cat.items.length === 0 && (
            <div className="fr" style={{ padding: 16, fontStyle: 'italic', fontSize: 14, color: C.muted, textAlign: 'center' }}>
              Nothing in this section matches your filters.
            </div>
          )}
          {cat.items.map(it => (
            <ItemRow key={it.id}
              item={it}
              config={config}
              done={!!checked[it.id]}
              onToggle={() => toggleItem(it.id)}
              onRemove={() => customIds.has(it.id) ? removeCustom(it.id) : removeItem(it.id)}
              tint={t}
            />
          ))}

          {/* Add custom */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 8px 4px' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { addCustom(newName); setNewName(''); } }}
              placeholder="Add your own…"
              style={{
                flex: 1, padding: '8px 10px', fontSize: 13,
                border: `1px dashed ${C.rule}`, background: 'transparent',
                borderRadius: 8, outline: 'none', color: C.ink,
              }}
            />
            <button
              onClick={() => { addCustom(newName); setNewName(''); }}
              className="lift mono"
              style={{
                fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
                padding: '0 12px', background: t.fg, color: '#fff',
                border: 'none', borderRadius: 8,
              }}>
              Add
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// =====================================================================
//  ITEM ROW
// =====================================================================
function ItemRow({ item, config, done, onToggle, onRemove, tint }) {
  // Resolve item weight against current config; show only if non-zero.
  const wKg = itemKg(item, config);
  const hasWeight = wKg > 0;
  const wDisplay = wKg >= 10 ? Math.round(wKg) : Math.round(wKg * 10) / 10;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 8px 8px 6px',
        borderRadius: 8,
      }}>
      <button
        onClick={onToggle}
        aria-label={done ? `Untick ${item.name}` : `Tick ${item.name}`}
        className="lift"
        style={{
          width: 24, height: 24, borderRadius: 6,
          border: `1.5px solid ${done ? tint.fg : C.rule}`,
          background: done ? tint.fg : 'transparent',
          color: '#fff', flexShrink: 0,
          display: 'grid', placeItems: 'center',
          transition: 'all .15s ease',
        }}>
        {done && <Check size={14} strokeWidth={3}/>}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14.5,
          color: done ? C.muted : C.ink,
          textDecoration: done ? 'line-through' : 'none',
          textDecorationColor: tint.fg,
          lineHeight: 1.3,
        }}>
          {item.name}
          {item.qty && (
            <span className="mono" style={{
              fontSize: 11, marginLeft: 8,
              color: done ? C.muted : tint.fg,
              background: done ? 'transparent' : tint.bg,
              padding: '2px 6px', borderRadius: 4,
              letterSpacing: 0.5,
            }}>
              {item.qty(config)}
            </span>
          )}
          {hasWeight && (
            <span className="mono" style={{
              fontSize: 10.5, marginLeft: 6,
              color: done ? C.muted : C.muted,
              background: 'transparent',
              border: `1px solid ${C.rule}`,
              padding: '1px 5px', borderRadius: 4,
              letterSpacing: 0.5,
              opacity: done ? 0.55 : 0.85,
              whiteSpace: 'nowrap',
            }}>
              {wDisplay} kg
            </span>
          )}
        </div>
      </div>
      <button onClick={onRemove} title="Remove from list"
        style={{
          background: 'transparent', border: 'none',
          color: C.muted, padding: 6, opacity: 0.6,
          display: 'grid', placeItems: 'center',
        }}>
        <X size={14}/>
      </button>
    </div>
  );
}

// =====================================================================
//  EMAIL CAPTURE (lead-gen)
// =====================================================================
function EmailCapture({ email, setEmail, saved, onSubmit }) {
  if (saved) {
    return (
      <section style={{
        background: C.forest, color: C.bg,
        border: `1px solid ${C.forestDk}`, borderRadius: 14,
        padding: 18, marginBottom: 10,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: C.forestDk, display: 'grid', placeItems: 'center' }}>
          <Check size={18}/>
        </div>
        <div>
          <div className="fr" style={{ fontSize: 18, fontWeight: 600 }}>You're on the list.</div>
          <div className="fr" style={{ fontStyle: 'italic', fontSize: 13, opacity: 0.85, lineHeight: 1.3 }}>
            Printable PDF and monthly prep tips on their way.
          </div>
        </div>
      </section>
    );
  }
  return (
    <section style={{
      background: C.forest, color: C.bg,
      border: `1px solid ${C.forestDk}`, borderRadius: 14,
      padding: 18, marginBottom: 10, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', right: -30, top: -30, width: 160, height: 160,
        borderRadius: '50%', background: C.forestDk, opacity: 0.5,
      }}/>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: 2, opacity: 0.7, textTransform: 'uppercase', marginBottom: 6 }}>
          Take this list with you
        </div>
        <h3 className="fr" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', lineHeight: 1.15 }}>
          The printable edition <em style={{ color: C.ochreLt }}>+ monthly prep dispatch</em>
        </h3>
        <p className="fr" style={{ fontStyle: 'italic', fontSize: 14, lineHeight: 1.4, opacity: 0.9, margin: '0 0 12px', maxWidth: 460 }}>
          Drop your email — we'll send the polished PDF version of your manifest plus one short, useful note per month on packing, places, and gear that actually works.
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
            type="email" placeholder="you@somewhere.com"
            style={{
              flex: 1, padding: '10px 12px', fontSize: 14,
              border: `1px solid ${C.bg}33`, background: `${C.bg}11`,
              color: C.bg, borderRadius: 10, outline: 'none',
            }}
          />
          <button onClick={onSubmit} className="lift"
            style={{
              background: C.ochre, color: C.forestDk, fontWeight: 600,
              border: 'none', borderRadius: 10, padding: '0 14px',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
            }}>
            <Send size={14}/> Send it
          </button>
        </div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.6, marginTop: 10, textTransform: 'uppercase' }}>
          One email a month. Unsubscribe any time.
        </div>
      </div>
    </section>
  );
}

// =====================================================================
//  TRIP BLUEPRINTS SECTION
//  An editorial entry point — pick a recognisable trip type, see what
//  real adventurers carry (and what they leave home), then apply the
//  config to the manifest with a single button.
// =====================================================================
function BlueprintSection({ onApply, currentConfig }) {
  const [open, setOpen] = useState(null);     // which blueprint is expanded
  const [shown, setShown] = useState(true);   // whole section show/hide

  // Which blueprint, if any, matches the current config closely enough to
  // be considered "loaded". Used to subtly mark the active card.
  const activeId = useMemo(() => {
    for (const bp of TRIP_BLUEPRINTS) {
      const c = bp.config;
      if (
        c.adults === currentConfig.adults &&
        c.kids === currentConfig.kids &&
        c.nights === currentConfig.nights &&
        c.setup === currentConfig.setup &&
        !!c.csr === !!currentConfig.csr
      ) return bp.id;
    }
    return null;
  }, [currentConfig]);

  return (
    <section style={{ marginBottom: 18 }}>
      <button
        onClick={() => setShown(s => !s)}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', padding: '6px 0 10px',
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase' }}>
            Trip blueprints
          </div>
          <div className="fr" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1, marginTop: 2 }}>
            Pick your adventure
          </div>
          <div className="fr" style={{ fontStyle: 'italic', fontSize: 14, color: C.muted, marginTop: 2 }}>
            Five archetypes built from real packing lists and trip reports.
          </div>
        </div>
        <ChevronDown size={18} style={{
          color: C.muted, transition: 'transform .2s ease',
          transform: shown ? 'rotate(180deg)' : 'none',
        }}/>
      </button>

      {shown && (
        <div style={{ display: 'grid', gap: 10 }} className="grow-in">
          {TRIP_BLUEPRINTS.map(bp => (
            <BlueprintCard
              key={bp.id}
              bp={bp}
              isOpen={open === bp.id}
              isActive={activeId === bp.id}
              onToggle={() => setOpen(o => o === bp.id ? null : bp.id)}
              onApply={() => onApply(bp)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BlueprintCard({ bp, isOpen, isActive, onToggle, onApply }) {
  const t = tintFor(bp.tint);
  const Icon = bp.icon;

  return (
    <article style={{
      background: C.paper,
      border: `1px solid ${isActive ? t.fg : C.rule}`,
      borderRadius: 14, overflow: 'hidden',
      boxShadow: isActive ? `0 0 0 2px ${t.bg}` : 'none',
      transition: 'box-shadow .2s ease',
    }}>
      <button onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
          padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
        }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: t.bg, color: t.dark,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon size={20}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h3 className="fr" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              {bp.title}
            </h3>
            {isActive && (
              <span className="mono" style={{
                fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase',
                color: t.fg, border: `1px solid ${t.fg}`,
                padding: '2px 6px', borderRadius: 4,
              }}>
                Loaded
              </span>
            )}
          </div>
          <p className="fr" style={{ fontStyle: 'italic', fontSize: 13.5, color: C.muted, margin: '4px 0 8px', lineHeight: 1.35 }}>
            {bp.tagline}
          </p>
          {/* Stats badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {bp.stats.map(([v, l], i) => (
              <div key={i} style={{
                background: 'transparent',
                border: `1px solid ${C.rule}`,
                borderRadius: 6, padding: '3px 8px',
                display: 'flex', flexDirection: 'column', minWidth: 0,
              }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: C.ink, lineHeight: 1.15 }}>{v}</span>
                <span className="mono" style={{ fontSize: 9, letterSpacing: 1, color: C.muted, textTransform: 'uppercase', lineHeight: 1.1, marginTop: 1 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
        <ChevronDown size={18} style={{
          color: C.muted, transition: 'transform .2s ease', marginTop: 6,
          transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0,
        }}/>
      </button>

      {isOpen && (
        <div className="grow-in" style={{ padding: '0 14px 14px', borderTop: `1px dashed ${C.rule}` }}>
          {/* Essentials */}
          <BPList
            label="Essentials"
            kicker="don't leave home without"
            tint={t}
            items={bp.essentials}
            bullet="•"
          />
          {/* Luxuries */}
          <BPList
            label="Luxuries"
            kicker="if weight allows"
            tint={t}
            items={bp.luxuries}
            bullet="◇"
          />
          {/* Weight savers */}
          <BPList
            label="Weight savers"
            kicker="how to shave kilograms"
            tint={t}
            items={bp.weightSavers}
            bullet="↓"
          />

          {bp.sourceNote && (
            <p className="fr" style={{
              fontStyle: 'italic', fontSize: 11.5, color: C.muted,
              margin: '14px 0 0', lineHeight: 1.4,
            }}>
              {bp.sourceNote}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              onClick={onApply}
              className="lift"
              style={{
                background: t.fg, color: '#fff',
                border: 'none', borderRadius: 10, padding: '10px 14px',
                fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
              <Check size={15}/> Load this trip
            </button>
            <div className="fr" style={{ fontStyle: 'italic', fontSize: 12, color: C.muted, alignSelf: 'center', flex: 1 }}>
              Sets trip profile · your ticks stay as you left them.
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function BPList({ label, kicker, tint, items, bullet }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{
          fontSize: 10, letterSpacing: 2, color: tint.fg,
          textTransform: 'uppercase', fontWeight: 600,
        }}>
          {label}
        </span>
        <span className="fr" style={{ fontStyle: 'italic', fontSize: 11.5, color: C.muted }}>
          {kicker}
        </span>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((it, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '4px 0', fontSize: 13.5, lineHeight: 1.45, color: C.ink2,
          }}>
            <span className="mono" style={{ color: tint.fg, fontWeight: 600, marginTop: 1, flexShrink: 0, minWidth: 12 }}>
              {bullet}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =====================================================================
//  TAB BAR
//  Pack ↔ Journal switcher. Sits under the masthead and persists.
// =====================================================================
function TabBar({ tab, setTab, journalCount, hasCrewTrip }) {
  const tabs = [
    { id: 'pack',    label: 'Pack',      icon: ListChecks, hint: 'before you leave' },
    { id: 'journal', label: 'Fuel',      icon: FileText,   hint: 'on the road' },
    { id: 'crew',    label: 'TripShare', icon: Users,      hint: 'shared list' },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
      background: C.paper, border: `1px solid ${C.rule}`,
      borderRadius: 12, padding: 4, marginBottom: 18,
    }}>
      {tabs.map(t => {
        const active = tab === t.id;
        const Icon = t.icon;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} className="lift"
            style={{
              background: active ? C.ink : 'transparent',
              color: active ? C.bg : C.ink,
              border: 'none', borderRadius: 9,
              padding: '10px 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, cursor: 'pointer', transition: 'background .15s ease',
            }}>
            <Icon size={15}/>
            <span className="fr" style={{ fontWeight: 600, fontSize: 15 }}>{t.label}</span>
            {t.id === 'journal' && journalCount > 0 && (
              <span className="mono" style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 999,
                background: active ? C.bg : C.ink, color: active ? C.ink : C.bg,
                fontWeight: 600, letterSpacing: 0.5,
              }}>
                {journalCount}
              </span>
            )}
            {t.id === 'crew' && hasCrewTrip && (
              <span className="mono" style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 999,
                background: active ? C.rust : C.rust, color: C.bg,
                fontWeight: 600, letterSpacing: 0.5,
              }}>
                live
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
//  JOURNAL VIEW — fuel, distance, cost tracking for the road
// =====================================================================
function JournalView({ tripName, setTripName, entries, setEntries, flash, config }) {
  const [showForm, setShowForm] = useState(entries.length === 0);
  const [editingId, setEditingId] = useState(null);
  const [prefillData, setPrefillData] = useState(null);   // pre-filled from fuel planner

  const stats   = useMemo(() => computeJournalStats(entries), [entries]);
  const display = useMemo(() => deriveJournalForDisplay(entries), [entries]);

  const upsertEntry = (entry) => {
    setEntries(prev => {
      const exists = prev.find(e => e.id === entry.id);
      return exists
        ? prev.map(e => e.id === entry.id ? entry : e)
        : [...prev, entry];
    });
    flash(editingId ? 'Fill-up updated.' : 'Fill-up logged.');
    setShowForm(false);
    setEditingId(null);
    setPrefillData(null);
  };

  const deleteEntry = (id) => {
    if (!confirm('Delete this fill-up? This cannot be undone.')) return;
    setEntries(prev => prev.filter(e => e.id !== id));
    flash('Fill-up deleted.');
  };

  const resetTrip = () => {
    if (!confirm(`Archive "${tripName}" and start a new trip?\n\nThis clears the current journal entries. Export to a file first if you want to keep them.`)) return;
    setEntries([]);
    setTripName('Current trip');
    flash('New trip started.');
  };

  // Pre-fill the fill-up form from a fuel planner result. Doesn't save yet —
  // the user still has to enter odo + litres at the bowser.
  const useStopAsFillUp = (stop) => {
    setEditingId(null);
    const locationParts = [stop.name, stop.state].filter(Boolean);
    setPrefillData({
      location: locationParts.join(', '),
      pricePerL: stop.pricePerL,
    });
    setShowForm(true);
    flash(`Pre-filled with ${stop.name}.`);
    setTimeout(() => {
      const el = document.querySelector('[data-anchor="fill-form"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  const exportCsv = () => {
    if (entries.length === 0) { flash('Nothing to export yet.'); return; }
    const rows = [
      ['Date', 'Location', 'Odometer (km)', 'Litres', 'Price/L (AUD)', 'Total cost (AUD)', 'Notes'],
      ...sortJournalAsc(entries).map(e => [
        e.date || '',
        e.location || '',
        e.odo ?? '',
        e.litres ?? '',
        e.pricePerL ?? '',
        e.totalCost ?? '',
        (e.notes || '').replaceAll('"', '""'),
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tripName.replace(/[^a-z0-9]/gi, '_')}_journal.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash('Journal exported.');
  };

  // For CSR context: compare burned-so-far against planned fuel
  const planned = config.csr || config.fuelL > 0 ? (config.fuelL || 700) : 0;

  return (
    <div className="grow-in">

      {/* ============= TRIP HEADER ============= */}
      <section style={{
        background: C.paper, border: `1px solid ${C.rule}`,
        borderRadius: 14, padding: 18, marginBottom: 14,
      }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>
          Active trip
        </div>
        <input
          value={tripName}
          onChange={e => setTripName(e.target.value)}
          placeholder="Name this trip…"
          className="fr"
          style={{
            width: '100%', fontSize: 28, fontWeight: 600,
            border: 'none', background: 'transparent', color: C.ink,
            padding: 0, outline: 'none', letterSpacing: '-0.01em',
          }}
        />
        <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 4, letterSpacing: 0.5 }}>
          {stats.count === 0
            ? 'No fill-ups yet · log your first one below'
            : `${stats.count} fill-up${stats.count === 1 ? '' : 's'} · started ${formatJournalDate(stats.firstDate)}`}
        </div>
      </section>

      {/* ============= STATS CARD ============= */}
      <JournalStatsCard stats={stats} planned={planned}/>

      {/* ============= FUEL ROUTE PLANNER ============= */}
      <FuelPlanner
        avgConsumption={stats.avgConsumption}
        onUseStop={useStopAsFillUp}
      />

      {/* ============= ACTIONS ============= */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button onClick={() => { setShowForm(true); setEditingId(null); setPrefillData(null); }} className="lift"
          style={{
            background: C.rust, color: C.bg, border: 'none',
            borderRadius: 10, padding: '12px 16px', fontSize: 14, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center',
          }}>
          <Plus size={16}/> Log a fill-up
        </button>
        <button onClick={exportCsv} title="Export to CSV"
          style={{
            background: C.paper, border: `1px solid ${C.rule}`, color: C.ink,
            borderRadius: 10, padding: '0 14px', display: 'grid', placeItems: 'center',
          }}>
          <Download size={16}/>
        </button>
        <button onClick={resetTrip} title="Start a new trip"
          style={{
            background: C.paper, border: `1px solid ${C.rule}`, color: C.ink,
            borderRadius: 10, padding: '0 14px', display: 'grid', placeItems: 'center',
          }}>
          <RotateCcw size={16}/>
        </button>
      </div>

      {/* ============= INLINE FORM ============= */}
      {showForm && (
        <div data-anchor="fill-form">
          <FillUpForm
            initial={editingId ? entries.find(e => e.id === editingId) : prefillData}
            lastOdo={stats.lastOdo}
            onCancel={() => { setShowForm(false); setEditingId(null); setPrefillData(null); }}
            onSave={upsertEntry}
          />
        </div>
      )}

      {/* ============= FILL-UPS LIST ============= */}
      {display.length === 0 ? (
        <EmptyJournal onAdd={() => setShowForm(true)}/>
      ) : (
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: 2, color: C.muted, textTransform: 'uppercase', margin: '14px 0 8px' }}>
            Fill-ups · newest first
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {display.map(e => (
              <FillUpCard key={e.id} entry={e}
                onEdit={() => { setEditingId(e.id); setPrefillData(null); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                onDelete={() => deleteEntry(e.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ============= FOOTER ============= */}
      <footer style={{ marginTop: 36, paddingTop: 18, borderTop: `1px solid ${C.rule}` }}>
        <p className="fr" style={{ fontStyle: 'italic', color: C.muted, fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          "Track the kilometres, count the kilos, watch the tank." A rough trip ledger beats a perfect memory.
        </p>
      </footer>
    </div>
  );
}

// ---------- Journal sub-components ----------

function JournalStatsCard({ stats, planned }) {
  const { count, totalLitres, totalCost, totalDistance, avgConsumption, avgCostPerKm, avgPricePerL } = stats;
  const fmtMoney = (n) => n == null ? '—' : `$${n.toFixed(2)}`;
  const fmtL = (n) => n == null ? '—' : `${n.toFixed(1)} L`;
  const fmtKm = (n) => n == null ? '—' : `${Math.round(n).toLocaleString()} km`;
  const fmtConsumption = (n) => n == null ? '—' : `${n.toFixed(1)}`;
  const fmtCostPerKm = (n) => n == null ? '—' : `$${n.toFixed(2)}`;

  return (
    <section style={{
      background: C.ink, color: C.bg,
      borderRadius: 14, marginBottom: 14, overflow: 'hidden', position: 'relative',
    }}>
      {/* topographic background */}
      <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.07, pointerEvents: 'none' }}>
        <defs>
          <pattern id="topo-j" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 110 Q 55 60 110 110 T 220 110" fill="none" stroke={C.bg} strokeWidth="0.8"/>
            <path d="M 0 140 Q 55 95 110 140 T 220 140" fill="none" stroke={C.bg} strokeWidth="0.6"/>
            <path d="M 0 80 Q 55 30 110 80 T 220 80" fill="none" stroke={C.bg} strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#topo-j)"/>
      </svg>

      <div style={{ position: 'relative', zIndex: 1, padding: 18 }}>
        {/* Hero number — total spend */}
        <div className="mono" style={{ fontSize: 11, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' }}>
          Fuel spend this trip
        </div>
        <div className="fr" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1, marginTop: 2 }}>
          {fmtMoney(totalCost)}
          <span className="mono" style={{ fontSize: 14, fontWeight: 400, marginLeft: 10, opacity: 0.6 }}>
            {fmtL(totalLitres)} · {fmtKm(totalDistance)}
          </span>
        </div>

        {/* Sub-stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
          <JStat label="Avg L/100km" big={fmtConsumption(avgConsumption)} small="consumption" />
          <JStat label="Cost / km"   big={fmtCostPerKm(avgCostPerKm)}    small="all-in"     />
          <JStat label="Avg $/L"     big={avgPricePerL == null ? '—' : `$${avgPricePerL.toFixed(2)}`} small="across fills" />
        </div>

        {/* Planned fuel vs used (CSR / preset context) */}
        {planned > 0 && (
          <div style={{ marginTop: 14 }}>
            <PlannedBar plannedL={planned} usedL={totalLitres}/>
          </div>
        )}

        {count < 2 && (
          <p className="fr" style={{ fontStyle: 'italic', fontSize: 13, lineHeight: 1.4, opacity: 0.78, margin: '14px 0 0' }}>
            Log at least two fill-ups to see your average consumption and cost per kilometre.
          </p>
        )}
      </div>
    </section>
  );
}

function JStat({ label, big, small }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 10, padding: '10px 12px',
    }}>
      <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.5, opacity: 0.6, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div className="fr" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, marginTop: 4 }}>
        {big}
      </div>
      <div className="mono" style={{ fontSize: 9, opacity: 0.5, marginTop: 2, letterSpacing: 0.5 }}>
        {small}
      </div>
    </div>
  );
}

function PlannedBar({ plannedL, usedL }) {
  const pct = Math.min(100, (usedL / plannedL) * 100);
  const remaining = Math.max(0, plannedL - usedL);
  const over = usedL > plannedL;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: 1.5, opacity: 0.65, textTransform: 'uppercase' }}>
          Trip fuel plan
        </div>
        <div className="mono" style={{ fontSize: 11, opacity: 0.8 }}>
          {usedL.toFixed(0)} / {plannedL} L
        </div>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: over ? C.rust : C.ochre,
          transition: 'width .3s ease',
        }}/>
      </div>
      <div className="mono" style={{ fontSize: 10, opacity: 0.55, marginTop: 4, letterSpacing: 0.5 }}>
        {over ? `OVER PLAN by ${(usedL - plannedL).toFixed(0)} L` : `~${remaining.toFixed(0)} L remaining on plan`}
      </div>
    </div>
  );
}

function FillUpForm({ initial, lastOdo, onCancel, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]     = useState(initial?.date || today);
  const [loc, setLoc]       = useState(initial?.location || '');
  const [odo, setOdo]       = useState(initial?.odo ?? '');
  const [litres, setLitres] = useState(initial?.litres ?? '');
  const [pricePerL, setPricePerL] = useState(initial?.pricePerL ?? '');
  const [totalCost, setTotalCost] = useState(initial?.totalCost ?? '');
  const [notes, setNotes]   = useState(initial?.notes || '');

  // Auto-compute total cost from litres × price, unless user overrides.
  const [costEdited, setCostEdited] = useState(false);
  useEffect(() => {
    if (costEdited) return;
    const l = parseFloat(litres), p = parseFloat(pricePerL);
    if (!isNaN(l) && !isNaN(p)) setTotalCost((l * p).toFixed(2));
  }, [litres, pricePerL, costEdited]);

  const submit = () => {
    const odoN     = parseFloat(odo);
    const litresN  = parseFloat(litres);
    const priceN   = parseFloat(pricePerL);
    const costN    = parseFloat(totalCost);
    if (isNaN(odoN) || isNaN(litresN)) {
      alert('Please enter at least an odometer reading and litres filled.');
      return;
    }
    const entry = {
      id: initial?.id || `j-${Date.now()}`,
      date,
      location: loc.trim(),
      odo: odoN,
      litres: litresN,
      pricePerL: isNaN(priceN) ? null : priceN,
      totalCost: isNaN(costN) ? (isNaN(priceN) ? null : litresN * priceN) : costN,
      notes: notes.trim(),
    };
    onSave(entry);
  };

  return (
    <section style={{
      background: C.paper, border: `1px solid ${C.rust}`,
      borderRadius: 14, padding: 16, marginBottom: 14,
      boxShadow: `0 0 0 3px ${C.rustLt}`,
    }} className="grow-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: 2, color: C.rust, textTransform: 'uppercase' }}>
            {initial?.id ? 'Editing fill-up' : (initial ? 'Pre-filled fill-up' : 'New fill-up')}
          </div>
          <div className="fr" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, marginTop: 2 }}>
            {initial?.id ? 'Log the numbers off the bowser' : (initial ? `Confirm at the bowser` : 'Log the numbers off the bowser')}
          </div>
        </div>
        <button onClick={onCancel}
          style={{
            background: 'transparent', border: 'none', color: C.muted,
            padding: 6, display: 'grid', placeItems: 'center', cursor: 'pointer',
          }}>
          <X size={18}/>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormField label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle}/>
        </FormField>
        <FormField label="Location">
          <input type="text" value={loc} onChange={e => setLoc(e.target.value)} placeholder="Birdsville…" style={inputStyle}/>
        </FormField>

        <FormField label="Odometer (km)" hint={lastOdo ? `last: ${lastOdo.toLocaleString()}` : null}>
          <input type="number" inputMode="numeric" value={odo} onChange={e => setOdo(e.target.value)} placeholder="145620" style={inputStyle}/>
        </FormField>
        <FormField label="Litres filled">
          <input type="number" inputMode="decimal" step="0.01" value={litres} onChange={e => setLitres(e.target.value)} placeholder="78.5" style={inputStyle}/>
        </FormField>

        <FormField label="Price per litre ($)">
          <input type="number" inputMode="decimal" step="0.01" value={pricePerL} onChange={e => { setPricePerL(e.target.value); setCostEdited(false); }} placeholder="1.95" style={inputStyle}/>
        </FormField>
        <FormField label="Total cost ($)" hint="auto from L × $/L">
          <input type="number" inputMode="decimal" step="0.01" value={totalCost} onChange={e => { setTotalCost(e.target.value); setCostEdited(true); }} placeholder="153.08" style={inputStyle}/>
        </FormField>
      </div>

      <FormField label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Long stretch ahead to Mt Dare. Tyres at 20 psi."
          style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}/>
      </FormField>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={submit} className="lift"
          style={{
            flex: 1, background: C.rust, color: C.bg, border: 'none',
            borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
          <Check size={16}/> Save fill-up
        </button>
        <button onClick={onCancel}
          style={{
            background: 'transparent', border: `1px solid ${C.rule}`, color: C.ink,
            borderRadius: 10, padding: '0 16px', fontSize: 14,
          }}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function FormField({ label, hint, children }) {
  return (
    <div style={{ gridColumn: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: 1.5, color: C.muted, textTransform: 'uppercase' }}>{label}</span>
        {hint && <span className="mono" style={{ fontSize: 9.5, color: C.muted, opacity: 0.7 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  border: `1px solid ${C.rule}`, background: '#fff', color: C.ink,
  borderRadius: 8, outline: 'none', boxSizing: 'border-box',
};

function FillUpCard({ entry, onEdit, onDelete }) {
  return (
    <article style={{
      background: C.paper, border: `1px solid ${C.rule}`,
      borderRadius: 12, padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span className="fr" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.15 }}>
              {entry.location || 'Unnamed stop'}
            </span>
            {entry.isFirst && (
              <span className="mono" style={{
                fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase',
                color: C.ochre, border: `1px solid ${C.ochre}`,
                padding: '2px 6px', borderRadius: 4,
              }}>
                Starting fill
              </span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {formatJournalDate(entry.date)} · odo {Number(entry.odo).toLocaleString()} km
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="fr" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1 }}>
            {entry.totalCost != null ? `$${Number(entry.totalCost).toFixed(2)}` : '—'}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
            {entry.litres != null ? `${Number(entry.litres).toFixed(1)} L` : '— L'}
            {entry.pricePerL != null && ` @ $${Number(entry.pricePerL).toFixed(2)}`}
          </div>
        </div>
      </div>

      {/* Leg stats (km since last + L/100km for this leg) */}
      {!entry.isFirst && (
        <div style={{
          display: 'flex', gap: 12, padding: '8px 10px',
          background: C.bg, borderRadius: 8, marginTop: 4,
          fontSize: 12, color: C.ink2,
        }}>
          <div>
            <span className="mono" style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Leg</span>
            <span style={{ marginLeft: 6, fontWeight: 600 }}>{entry.kmSince != null ? `${Math.round(entry.kmSince).toLocaleString()} km` : '—'}</span>
          </div>
          <div>
            <span className="mono" style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Used</span>
            <span style={{ marginLeft: 6, fontWeight: 600 }}>{entry.legConsumption != null ? `${entry.legConsumption.toFixed(1)} L/100km` : '—'}</span>
          </div>
        </div>
      )}

      {entry.notes && (
        <p className="fr" style={{ fontStyle: 'italic', fontSize: 13, color: C.ink2, margin: '8px 0 0', lineHeight: 1.4 }}>
          {entry.notes}
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={onEdit}
          style={{
            background: 'transparent', border: `1px solid ${C.rule}`, color: C.ink,
            borderRadius: 8, padding: '4px 10px', fontSize: 12,
          }}>
          Edit
        </button>
        <button onClick={onDelete}
          style={{
            background: 'transparent', border: `1px solid ${C.rule}`, color: C.muted,
            borderRadius: 8, padding: '4px 10px', fontSize: 12,
          }}>
          Delete
        </button>
      </div>
    </article>
  );
}

function EmptyJournal({ onAdd }) {
  return (
    <section style={{
      background: C.paper, border: `1px dashed ${C.rule}`,
      borderRadius: 14, padding: 26, textAlign: 'center', marginTop: 8,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, margin: '0 auto 12px',
        background: C.rustLt, color: C.rust,
        display: 'grid', placeItems: 'center',
      }}>
        <FileText size={20}/>
      </div>
      <h3 className="fr" style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px' }}>
        No fill-ups yet
      </h3>
      <p className="fr" style={{ fontStyle: 'italic', fontSize: 14, color: C.muted, margin: '0 0 16px', lineHeight: 1.4 }}>
        Log every fill-up with date, location, litres and price.<br/>
        The journal will work out the rest.
      </p>
      <button onClick={onAdd} className="lift"
        style={{
          background: C.rust, color: C.bg, border: 'none',
          borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
        <Plus size={16}/> Log first fill-up
      </button>
    </section>
  );
}

function formatJournalDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return isoStr; }
}

// =====================================================================
//  FUEL ROUTE PLANNER
//  Uses the Anthropic API with web search to find current fuel prices
//  along a driving route. Returns recommended stops with prices, type,
//  and confidence. Each stop can be pre-filled into the journal form.
// =====================================================================

const POPULAR_ROUTES = [
  { id: 'hume',      start: 'Sydney NSW',     end: 'Melbourne VIC',  label: 'Hume Hwy' },
  { id: 'cape',      start: 'Cairns QLD',     end: 'Bamaga QLD',     label: 'Cape York' },
  { id: 'simpson',   start: 'Birdsville QLD', end: 'Mt Dare SA',     label: 'Simpson' },
  { id: 'canning',   start: 'Wiluna WA',      end: 'Halls Creek WA', label: 'Canning' },
  { id: 'nullarbor', start: 'Adelaide SA',    end: 'Perth WA',       label: 'Nullarbor' },
  { id: 'topend',    start: 'Darwin NT',      end: 'Broome WA',      label: 'Top End' },
];

// =====================================================================
//  OFFLINE ROUTE REFERENCE DATA
//  Curated from typical recent prices on Australian highways and remote
//  routes. Used as an instant-load source when the mobile sandbox blocks
//  live web search, and as a fallback for the freeform search button.
//  Prices are deliberately conservative reference figures, flagged
//  'estimated' on every stop so users know to verify at the bowser.
// =====================================================================
const LOADING_PHRASES = [
  'Plotting the route…',
  'Checking current fuel prices…',
  'Searching roadhouses and town stations…',
  'Comparing prices along the way…',
  'Working out your fuel strategy…',
];

// Robust JSON extraction — Claude sometimes wraps in markdown despite instructions.
function extractJson(text) {
  let s = (text || '').replace(/```(?:json|JSON)?\s*/g, '').replace(/```\s*$/g, '').trim();
  // Strip any leading array bracket that can appear when tool_use blocks wrap the response
  s = s.replace(/^\s*\]\s*/, '').replace(/\s*\[\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in response');
  return JSON.parse(s.slice(start, end + 1));
}

// =====================================================================
//  FUEL PLANNER — online, single-route.
//  Input start + end → ask Claude (via the Anthropic API + web_search)
//  for the cheapest fuel stops roughly every {intervalKm} along the way.
//  Returns map + stop list with current prices. Requires network.
// =====================================================================

function FuelPlanner({ avgConsumption, onUseStop }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [fuelType, setFuelType] = useState('Diesel');
  const [intervalKm, setIntervalKm] = useState(100);
  const [tankRange, setTankRange] = useState(0);
  const [savedPlans, setSavedPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_PHRASES[0]);
  const plannerLoaded = useRef(false);

  // Persistent tank range + saved plans via window.storage
  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined' || !window.storage) {
        plannerLoaded.current = true; return;
      }
      try {
        const r = await window.storage.get('fm-tank-range');
        if (r) setTankRange(Number(r.value) || 0);
      } catch (e) { /* ignore */ }
      try {
        const r = await window.storage.get('fm-saved-plans');
        if (r) {
          const parsed = JSON.parse(r.value);
          if (Array.isArray(parsed)) setSavedPlans(parsed);
        }
      } catch (e) { /* ignore */ }
      plannerLoaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!plannerLoaded.current || !window.storage) return;
    window.storage.set('fm-tank-range', String(tankRange)).catch(() => {});
  }, [tankRange]);
  useEffect(() => {
    if (!plannerLoaded.current || !window.storage) return;
    window.storage.set('fm-saved-plans', JSON.stringify(savedPlans)).catch(() => {});
  }, [savedPlans]);

  // Cycle loading messages while waiting
  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % LOADING_PHRASES.length;
      setLoadingMsg(LOADING_PHRASES[i]);
    }, 1800);
    return () => clearInterval(t);
  }, [loading]);

  const savePlan = () => {
    if (!result) return;
    const defaultLabel = `${start} → ${end}`;
    const label = prompt('Name this saved plan:', defaultLabel);
    if (!label || !label.trim()) return;
    const plan = {
      id: `plan-${Date.now()}`,
      label: label.trim(),
      start, end, fuelType, intervalKm,
      savedAt: new Date().toISOString(),
      result,
    };
    setSavedPlans(prev => [plan, ...prev.filter(p => p.label !== plan.label)].slice(0, 12));
  };

  const loadPlan = (plan) => {
    setStart(plan.start || '');
    setEnd(plan.end || '');
    setFuelType(plan.fuelType || 'Diesel');
    setIntervalKm(plan.intervalKm || 200);
    setResult(plan.result || null);
    setError(null);
  };

  const deletePlan = (id) => {
    if (!confirm('Delete this saved plan?')) return;
    setSavedPlans(prev => prev.filter(p => p.id !== id));
  };

  const exportPlan = () => {
    if (!result) return;
    const consumption = avgConsumption || 12;
    const lines = [];
    lines.push('THE FIELD MANIFEST — Fuel Route Plan');
    lines.push('═══════════════════════════════════════════');
    lines.push(`Route        : ${result.route || `${start} → ${end}`}`);
    lines.push(`Distance     : ${Math.round(result.totalDistanceKm || 0).toLocaleString()} km`);
    lines.push(`Fuel type    : ${result.fuelType || fuelType}`);
    lines.push(`Consumption  : ${consumption.toFixed(1)} L/100km`);
    if (tankRange > 0) lines.push(`Tank range   : ${tankRange} km`);
    lines.push(`Generated    : ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    lines.push('');
    if (result.advice) {
      lines.push('STRATEGY');
      lines.push('───────────────────────────────────────────');
      lines.push(result.advice);
      lines.push('');
    }
    lines.push('STOPS');
    lines.push('───────────────────────────────────────────');
    (result.stops || []).forEach((s, i) => {
      const km = Math.round(s.distFromStartKm || 0);
      const price = s.pricePerL != null ? `$${Number(s.pricePerL).toFixed(2)}/L` : 'price n/a';
      const conf = s.priceConfidence ? ` (${s.priceConfidence})` : '';
      const typeLabel = s.type ? ` · ${s.type}` : '';
      lines.push(`${String(i + 1).padStart(2, ' ')}. ${s.name}${s.state ? ` (${s.state})` : ''}`);
      lines.push(`    ${km.toLocaleString()} km from start${typeLabel}`);
      lines.push(`    ${price}${conf}`);
      if (s.notes) lines.push(`    ↪ ${s.notes}`);
      if (i < (result.stops || []).length - 1) {
        const next = result.stops[i + 1];
        const legKm = Math.max(0, Math.round((next.distFromStartKm || 0) - km));
        const legFuelL = Math.round((legKm * consumption) / 100);
        lines.push(`    → leg: ${legKm.toLocaleString()} km · ~${legFuelL} L`);
      }
      lines.push('');
    });
    lines.push('───────────────────────────────────────────');
    lines.push('Prices may be a few days old. Confirm at the bowser.');
    lines.push('Field Manifest · bootkamp.co');

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (s) => (s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    a.download = `fuel-plan_${slug(start)}_to_${slug(end)}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // ── NSW Fuel API constants ──────────────────────────────────────────
  const NSW_API_KEY  = '1MYSRAx5yvqHUZc6VGtxix6oMA2qgfRT';
  const NSW_AUTH     = 'Basic MU1ZU1JBeDV5dnFIVVpjNlZHdHhpeDZvTUEycWdmUlQ6Qk12V2FjdzE1RXQ4dUZHRg==';
  const PROXIES      = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
  ];

  // Map UI fuel type → NSW API fueltype code
  const fuelCode = { Diesel: 'DL', '91 Unleaded': 'U91', '95 Premium': 'P95', '98 Premium': 'P98', E10: 'E10' };

  // Haversine distance in km
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Geocode via Nominatim
  async function geocode(q) {
    if (!q) return null;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Australia')}&format=json&limit=1&countrycodes=au`);
      const d = await r.json();
      if (d.length > 0) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon), name: d[0].display_name.split(',')[0] };
    } catch (e) {}
    return null;
  }

  // OSRM route geometry
  async function getRoute(fromLat, fromLon, toLat, toLon) {
    try {
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.code === 'Ok' && d.routes[0]) {
        return { coords: d.routes[0].geometry.coordinates, distanceKm: d.routes[0].distance / 1000 };
      }
    } catch (e) {}
    return null;
  }

  // Evenly spaced stops along the route
  function makeStops(coords, intervalKm) {
    const stops = [];
    let dist = 0, last = 0;
    stops.push({ lat: coords[0][1], lon: coords[0][0], d: 0 });
    for (let i = 1; i < coords.length; i++) {
      dist += haversine(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
      if (dist - last >= intervalKm) {
        stops.push({ lat: coords[i][1], lon: coords[i][0], d: dist });
        last = dist;
      }
    }
    const last_ = stops[stops.length - 1];
    if (!last_ || last_.d < dist * 0.85) {
      stops.push({ lat: coords[coords.length-1][1], lon: coords[coords.length-1][0], d: dist });
    }
    return stops;
  }

  // Try to get NSW Fuel API token via CORS proxy
  async function getNSWToken() {
    for (const proxy of PROXIES) {
      try {
        const url = proxy + encodeURIComponent('https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials');
        const r = await fetch(url, { headers: { Authorization: NSW_AUTH } });
        if (r.ok) {
          const d = await r.json();
          if (d.access_token) return { token: d.access_token, proxy };
        }
      } catch (e) {}
    }
    return null;
  }

  // Query NSW Fuel API for stations near a point
  async function nearbyNSW(lat, lon, radiusKm, token, proxy) {
    const code = fuelCode[fuelType] || 'DL';
    const ts   = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: true });
    try {
      const url = proxy + encodeURIComponent('https://api.onegov.nsw.gov.au/FuelPriceCheck/v2/fuel/prices/nearby');
      const r   = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
          apikey: NSW_API_KEY,
          transactionid: `t${Date.now()}`,
          requesttimestamp: ts,
        },
        body: JSON.stringify({
          fueltype: code, brand: [], namedlocation: '',
          latitude: lat.toFixed(6), longitude: lon.toFixed(6),
          radius: radiusKm.toString(), sortby: 'price', sortascending: 'true',
        }),
      });
      if (!r.ok) return [];
      const d = await r.json();
      if (!d.stations || !d.prices) return [];
      const sm = {};
      d.stations.forEach(s => sm[String(s.code)] = s);
      return d.prices
        .filter(p => p.fueltype === code)
        .map(p => {
          const s = sm[String(p.stationcode)];
          if (!s) return null;
          return {
            name: s.name,
            state: 'NSW',
            distFromStartKm: 0,
            lat: s.location.latitude,
            lng: s.location.longitude,
            pricePerL: p.price / 100,   // API returns cents, convert to $/L
            type: 'town',
            priceConfidence: 'live',
            notes: `${s.brand} · ${s.address}`,
            _distFromStop: haversine(lat, lon, s.location.latitude, s.location.longitude),
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.pricePerL || 99) - (b.pricePerL || 99));
    } catch (e) {
      return [];
    }
  }

  // Claude AI fallback — used when NSW API unavailable or route is outside NSW
  const buildPrompt = (s, e) => `Plan an Australian ${fuelType} fuel route from "${s}" to "${e}". Use web search to find the cheapest current prices (NSW FuelCheck, FuelWatch WA, MyFuel NT, MotorMouth, PetrolSpy, roadhouse sites).

Goal: list the CHEAPEST fuel options roughly every ${intervalKm}km along the driving route — the user should be able to skim it and know exactly where to fill up.

Rules:
- Include the start and end as stops.
- Aim for one stop every ${intervalKm}km. Short routes (<400km) can have fewer; long routes (>1000km) should have more.
- For remote routes (Birdsville Track, Tanami, Plenty Hwy, Old Telegraph Track, Outback Way, Canning) include EVERY available roadhouse — fuel scarcity beats price.
- Where multiple stations exist in a town, pick the cheapest one.
- Note where remote roadhouses charge a premium.
- ALWAYS include approximate lat/lng (decimal degrees) for every stop — estimate from general knowledge if needed.
- If user mentions a highway or "via" point, treat as a hard routing constraint.

Respond with ONLY this JSON, no prose or markdown:
{"route":"Start → End","totalDistanceKm":0,"fuelType":"${fuelType}","stops":[{"name":"","state":"","distFromStartKm":0,"lat":0,"lng":0,"pricePerL":null,"type":"town|roadhouse|remote|fuel-cache","priceConfidence":"live|recent|estimated","notes":""}],"advice":""}

Sort stops ascending by distFromStartKm. Keep notes ≤80 chars. Keep advice to 1–2 sentences naming the cheapest fill points and any expensive ones to skip.`;

  const searchRouteClaude = async (s, e) => {
    const response = await fetch('/.netlify/functions/plan-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: buildPrompt(s, e) }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Search request failed (${response.status}): ${responseText.substring(0, 200)}`);
    let data;
    try { data = JSON.parse(responseText); } catch (e) { throw new Error(`API returned invalid JSON: ${e.message}`); }
    const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    if (!text) throw new Error('Empty response — the search returned no text content.');
    const parsed = extractJson(text);
    if (!Array.isArray(parsed.stops)) throw new Error('Response missing stops array.');
    parsed.stops = parsed.stops.map(stop => ({
      ...stop,
      distFromStartKm: Number(stop.distFromStartKm) || 0,
      pricePerL: stop.pricePerL == null ? null : Number(stop.pricePerL),
      lat: stop.lat == null || isNaN(Number(stop.lat)) ? null : Number(stop.lat),
      lng: stop.lng == null || isNaN(Number(stop.lng)) ? null : Number(stop.lng),
    })).sort((a, b) => a.distFromStartKm - b.distFromStartKm);
    return parsed;
  };

  // Main search — tries NSW Fuel API first, falls back to Claude AI
  const searchRoute = async (s, e) => {
    // Step 1: geocode both ends
    setLoadingMsg('Finding route…');
    const [fromPt, toPt] = await Promise.all([geocode(s), geocode(e)]);
    if (!fromPt || !toPt) throw new Error('Could not find one or both locations. Try adding the state (e.g. "Dubbo NSW").');

    // Step 2: get driving route from OSRM
    setLoadingMsg('Plotting the route…');
    const route = await getRoute(fromPt.lat, fromPt.lon, toPt.lat, toPt.lon);
    const totalDistanceKm = route ? Math.round(route.distanceKm) : Math.round(haversine(fromPt.lat, fromPt.lon, toPt.lat, toPt.lon));

    // Step 3: try NSW Fuel API (live prices)
    setLoadingMsg('Checking current fuel prices…');
    const nswAuth = await getNSWToken();

    if (nswAuth) {
      // NSW API available — query each stop
      const coords   = route ? route.coords : [[fromPt.lon, fromPt.lat], [toPt.lon, toPt.lat]];
      const stopPts  = makeStops(coords, intervalKm);
      const allStops = [];

      for (let i = 0; i < stopPts.length; i++) {
        setLoadingMsg(`Stop ${i + 1} of ${stopPts.length}: searching…`);
        const sp       = stopPts[i];
        const stations = await nearbyNSW(sp.lat, sp.lon, 15, nswAuth.token, nswAuth.proxy);
        if (stations.length > 0) {
          const best = stations[0];
          allStops.push({
            ...best,
            distFromStartKm: Math.round(sp.d),
          });
        } else {
          // No station found at this stop — skip it silently
        }
      }

      if (allStops.length === 0) {
        // NSW API connected but no results — fall through to Claude
      } else {
        // Ensure start and end are included
        if (allStops[0]?.distFromStartKm > 5) {
          allStops.unshift({ name: s, state: '', distFromStartKm: 0, lat: fromPt.lat, lng: fromPt.lon, pricePerL: null, type: 'town', priceConfidence: 'estimated', notes: 'Starting point' });
        }
        allStops.push({ name: e, state: '', distFromStartKm: totalDistanceKm, lat: toPt.lat, lng: toPt.lon, pricePerL: null, type: 'town', priceConfidence: 'estimated', notes: 'Destination' });

        return {
          route: `${s} → ${e}`,
          totalDistanceKm,
          fuelType,
          stops: allStops,
          advice: `Live prices from NSW Fuel API. ${allStops.filter(st => st.pricePerL).length} stations with current prices found along your route.`,
          _source: 'nsw-api',
        };
      }
    }

    // Step 4: Fall back to Claude AI with web search
    setLoadingMsg('Searching roadhouses and stations…');
    const claudeResult = await searchRouteClaude(s, e);
    claudeResult._source = 'claude-ai';
    if (!claudeResult.totalDistanceKm && totalDistanceKm) claudeResult.totalDistanceKm = totalDistanceKm;
    return claudeResult;
  };

  const handleQuickRoute = (r) => {
    setStart(r.start);
    setEnd(r.end);
    setResult(null);
    setError(null);
  };

  const findStops = async () => {
    if (!start.trim() || !end.trim()) {
      setError('Please enter both a start and end point.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setLoadingMsg(LOADING_PHRASES[0]);
    try {
      const r = await searchRoute(start, end);
      setResult(r);
    } catch (err) {
      console.error('FuelPlanner error:', err);
      setError(err.message || 'Could not plan the route. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{
      background: C.paper, border: `1px solid ${C.rule}`,
      borderRadius: 14, marginBottom: 14, overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
          padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10,
          background: C.rustLt, color: C.rust,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Fuel size={20}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h3 className="fr" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              Fuel route planner
            </h3>
            <span className="mono" style={{
              fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase',
              color: C.rust, border: `1px solid ${C.rust}`,
              padding: '2px 6px', borderRadius: 4, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <Sparkles size={10}/> Live prices
            </span>
          </div>
          <p className="fr" style={{ fontStyle: 'italic', fontSize: 13.5, color: C.muted, margin: '4px 0 0', lineHeight: 1.35 }}>
            Cheapest fuel stops along your drive, looked up live.
          </p>
        </div>
        <ChevronDown size={18} style={{
          color: C.muted, transition: 'transform .2s ease',
          transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0,
        }}/>
      </button>

      {open && (
        <div className="grow-in" style={{ padding: '0 14px 14px', borderTop: `1px dashed ${C.rule}` }}>

          {/* Quick routes */}
          <div style={{ marginTop: 14 }}>
            <Label>Quick route</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {POPULAR_ROUTES.map(r => (
                <Chip key={r.label} onClick={() => handleQuickRoute(r)}>{r.label}</Chip>
              ))}
            </div>
          </div>

          {/* Saved plans */}
          {savedPlans.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Label>Your saved plans</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {savedPlans.map(p => (
                  <SavedPlanChip key={p.id} plan={p} onLoad={() => loadPlan(p)} onDelete={() => deletePlan(p.id)}/>
                ))}
              </div>
            </div>
          )}

          {/* Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            <FormField label="From">
              <input value={start} onChange={e => setStart(e.target.value)}
                placeholder="Birdsville QLD" style={inputStyle}/>
            </FormField>
            <FormField label="To">
              <input value={end} onChange={e => setEnd(e.target.value)}
                placeholder="Mt Dare SA" style={inputStyle}/>
            </FormField>
            <FormField label="Fuel type">
              <select value={fuelType} onChange={e => setFuelType(e.target.value)} style={inputStyle}>
                <option>Diesel</option>
                <option>91 Unleaded</option>
                <option>95 Premium</option>
                <option>98 Premium</option>
                <option>E10</option>
              </select>
            </FormField>
            <FormField label="Stop interval">
              <select value={intervalKm} onChange={e => setIntervalKm(Number(e.target.value))} style={inputStyle}>
                <option value={100}>~100 km (recommended)</option>
                <option value={150}>~150 km</option>
                <option value={200}>~200 km</option>
                <option value={300}>~300 km (remote)</option>
              </select>
            </FormField>
          </div>

          {/* Tank range */}
          <div style={{ marginTop: 10 }}>
            <FormField
              label="Your usable tank range (km)"
              hint={tankRange > 0 ? 'flags legs that exceed it' : 'optional · saved for next time'}
            >
              <input
                type="number" inputMode="numeric" min="0" step="50"
                value={tankRange || ''}
                onChange={e => setTankRange(Number(e.target.value) || 0)}
                placeholder="e.g. 800"
                style={inputStyle}
              />
            </FormField>
          </div>

          {/* Submit */}
          <button onClick={findStops} disabled={loading} className="lift"
            style={{
              width: '100%', marginTop: 14,
              background: loading ? C.muted : C.rust, color: C.bg, border: 'none',
              borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.95 : 1, transition: 'background .2s ease',
            }}>
            {loading ? (
              <span>{loadingMsg}</span>
            ) : (
              <>
                <Compass size={16}/>
                <span>{result ? 'Re-run search' : 'Find fuel stops'}</span>
              </>
            )}
          </button>

          {error && (
            <div style={{
              marginTop: 12, padding: 12,
              background: C.rustLt, color: C.rustDk,
              border: `1px solid ${C.rust}`, borderRadius: 10,
              fontSize: 13, lineHeight: 1.4,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }}/>
              <span><strong>Couldn't plan that route.</strong> {error}</span>
            </div>
          )}

          {result && (
            <FuelResults
              data={result}
              avgConsumption={avgConsumption}
              tankRange={tankRange}
              onUseStop={onUseStop}
              onSavePlan={savePlan}
              onExportPlan={exportPlan}
              routeColor={C.rust}
            />
          )}

          <p className="fr" style={{
            fontStyle: 'italic', fontSize: 11.5, color: C.muted,
            margin: '14px 0 0', lineHeight: 1.4,
          }}>
            Prices fetched live by web search and may be a few days old. Remote roadhouses rarely publish prices online — estimated values are flagged.
          </p>
        </div>
      )}
    </section>
  );
}

function FuelResults({ data, avgConsumption, tankRange, onUseStop, onSavePlan, onExportPlan, routeColor }) {
  const stops = Array.isArray(data.stops) ? data.stops : [];
  if (stops.length === 0) {
    return (
      <div style={{
        marginTop: 14, padding: 14,
        background: C.paper2, border: `1px solid ${C.rule}`, borderRadius: 10,
        fontSize: 13.5, color: C.ink2, lineHeight: 1.5,
      }}>
        {data.advice || 'No fuel stops found along this route.'}
      </div>
    );
  }

  const consumption  = avgConsumption || 12;
  const totalDistance = data.totalDistanceKm || stops[stops.length - 1].distFromStartKm || 0;
  const fuelL = (totalDistance * consumption) / 100;

  const priced = stops.filter(s => s.pricePerL != null);
  const avgPrice = priced.length > 0 ? priced.reduce((a, s) => a + s.pricePerL, 0) / priced.length : null;
  const estCost = avgPrice != null ? fuelL * avgPrice : null;

  const cheapest = priced.length > 0 ? priced.reduce((a, b) => a.pricePerL < b.pricePerL ? a : b) : null;
  const dearest  = priced.length > 0 ? priced.reduce((a, b) => a.pricePerL > b.pricePerL ? a : b) : null;

  const priceSpread = priced.length >= 2 ? (dearest.pricePerL - cheapest.pricePerL) : 0;
  const possibleSavings = priceSpread > 0 && fuelL > 0 ? priceSpread * fuelL * 0.5 : 0;

  // ---- Tank range analysis ----
  const hasTank = tankRange > 0;
  let exceedsCount = 0;
  let tightCount = 0;
  const legs = stops.map((s, i) => {
    if (i === 0) return { km: 0, ratio: 0, severity: 'ok' };
    const km = Math.max(0, s.distFromStartKm - stops[i - 1].distFromStartKm);
    const ratio = hasTank ? km / tankRange : 0;
    let severity = 'ok';
    if (hasTank) {
      if (ratio > 1)      { severity = 'over';  exceedsCount++; }
      else if (ratio > 0.85) { severity = 'tight'; tightCount++; }
    }
    return { km, ratio, severity };
  });

  const lineColor = routeColor || C.rust;

  return (
    <div style={{ marginTop: 16 }} className="grow-in">
      {/* Map at the top */}
      <RouteMap routes={[{ stops, color: lineColor, label: '' }]} height={280}/>

      {/* Route summary on dark */}
      <div style={{
        background: C.ink, color: C.bg, borderRadius: 12, padding: 14,
        marginTop: 12, marginBottom: 12, position: 'relative', overflow: 'hidden',
      }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: 1.8, opacity: 0.6, textTransform: 'uppercase' }}>
          Route summary
        </div>
        <div className="fr" style={{ fontSize: 19, fontWeight: 600, marginTop: 4, lineHeight: 1.2 }}>
          {data.route}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          <SmallStat label="Distance"  value={`${Math.round(totalDistance).toLocaleString()} km`}/>
          <SmallStat label={`Fuel @ ${consumption.toFixed(1)}L/100`} value={`${Math.round(fuelL)} L`}/>
          <SmallStat label="Est. cost" value={estCost != null ? `$${Math.round(estCost).toLocaleString()}` : '—'}/>
        </div>

        {/* Tank range warning */}
        {hasTank && exceedsCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: 'rgba(168, 71, 26, 0.25)',
            border: `1px solid ${C.rust}`, borderRadius: 8,
            padding: '8px 10px', marginTop: 10, fontSize: 12.5, lineHeight: 1.4,
          }}>
            <AlertTriangle size={14} style={{ marginTop: 2, color: C.rustLt, flexShrink: 0 }}/>
            <div>
              <strong>{exceedsCount} leg{exceedsCount === 1 ? '' : 's'} exceed{exceedsCount === 1 ? 's' : ''} your {tankRange} km tank range.</strong>
              {' '}You'd need to carry extra fuel or find an additional stop before running dry.
            </div>
          </div>
        )}
        {hasTank && exceedsCount === 0 && tightCount > 0 && (
          <div className="mono" style={{
            fontSize: 11, marginTop: 10, opacity: 0.85, letterSpacing: 0.5,
            background: 'rgba(197, 138, 42, 0.18)', padding: '6px 10px',
            borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={12}/>
            <span>{tightCount} leg{tightCount === 1 ? '' : 's'} use 85%+ of tank — no margin for detours.</span>
          </div>
        )}

        {possibleSavings > 5 && (
          <div className="mono" style={{
            fontSize: 11, marginTop: 10, opacity: 0.85, letterSpacing: 0.5,
            background: 'rgba(255,255,255,0.08)', padding: '6px 10px',
            borderRadius: 6, display: 'inline-block',
          }}>
            Smart fill order could save you ~${Math.round(possibleSavings)} on this route.
          </div>
        )}
        {avgConsumption == null && (
          <div className="mono" style={{ fontSize: 9.5, opacity: 0.55, marginTop: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Default 12 L/100km — log fill-ups to use your real consumption.
          </div>
        )}

        {/* Action buttons: save and export */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {onSavePlan && (
            <button onClick={onSavePlan} className="lift"
              style={{
                background: 'rgba(255,255,255,0.1)', color: C.bg,
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                padding: '7px 10px', fontSize: 12, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              }}>
              <Plus size={13}/> Save plan
            </button>
          )}
          {onExportPlan && (
            <button onClick={onExportPlan} className="lift"
              style={{
                background: 'rgba(255,255,255,0.1)', color: C.bg,
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                padding: '7px 10px', fontSize: 12, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              }}>
              <Download size={13}/> Export as text
            </button>
          )}
        </div>
      </div>

      {/* Strategy advice */}
      {data.advice && (
        <div style={{
          background: C.forestLt, color: C.forestDk,
          border: `1px solid ${C.forest}33`, borderRadius: 10,
          padding: 12, marginBottom: 12,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: C.forest, color: C.bg,
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <Sparkles size={14}/>
          </div>
          <p className="fr" style={{ fontStyle: 'italic', fontSize: 13.5, margin: 0, lineHeight: 1.4 }}>
            {data.advice}
          </p>
        </div>
      )}

      {/* Stops */}
      <div className="mono" style={{ fontSize: 10, letterSpacing: 1.8, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>
        {stops.length} stop{stops.length === 1 ? '' : 's'} along the way
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {stops.map((s, i) => {
          const legInfo = legs[i];
          const legFuelL = (legInfo.km * consumption) / 100;
          const sevColor = legInfo.severity === 'over' ? C.rust
                         : legInfo.severity === 'tight' ? C.ochre
                         : C.muted;
          return (
            <React.Fragment key={`${s.name}-${s.distFromStartKm}-${i}`}>
              {i > 0 && (
                <div style={{ paddingLeft: 18 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    color: sevColor,
                  }} className="mono">
                    <ArrowRight size={11}/>
                    <span style={{ fontSize: 11 }}>
                      {Math.round(legInfo.km).toLocaleString()} km · ~{Math.round(legFuelL)} L
                    </span>
                    {hasTank && legInfo.severity !== 'ok' && (
                      <span style={{
                        fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                        background: sevColor, color: '#fff',
                        padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                      }}>
                        {legInfo.severity === 'over' ? 'Out of range' : 'Tight'}
                      </span>
                    )}
                  </div>
                  {hasTank && (
                    <div style={{
                      height: 3, background: C.rule, borderRadius: 2,
                      marginTop: 3, marginBottom: 3, overflow: 'hidden',
                      maxWidth: 160,
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, legInfo.ratio * 100)}%`,
                        background: sevColor,
                        transition: 'width .3s ease',
                      }}/>
                    </div>
                  )}
                </div>
              )}
              <StopCard stop={s}
                isStart={i === 0}
                isEnd={i === stops.length - 1}
                isCheapest={cheapest && s === cheapest}
                isDearest={dearest && s === dearest && dearest !== cheapest}
                onUse={() => onUseStop(s)}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Compact chip-style display for a saved plan, with an inline delete button.
function SavedPlanChip({ plan, onLoad, onDelete }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'stretch',
      border: `1px solid ${C.rule}`, borderRadius: 999, overflow: 'hidden',
      background: C.paper,
    }}>
      <button onClick={onLoad}
        style={{
          background: 'transparent', border: 'none', color: C.ink,
          padding: '6px 4px 6px 12px', fontSize: 12.5, cursor: 'pointer',
          maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
        {plan.label}
      </button>
      <button onClick={onDelete} title="Delete saved plan"
        style={{
          background: 'transparent', border: 'none', borderLeft: `1px solid ${C.rule}`,
          color: C.muted, padding: '0 8px', display: 'grid', placeItems: 'center',
          cursor: 'pointer',
        }}>
        <X size={12}/>
      </button>
    </div>
  );
}

function StopCard({ stop, isStart, isEnd, isCheapest, isDearest, onUse }) {
  const typeLabel = {
    'town': 'Town',
    'roadhouse': 'Roadhouse',
    'remote': 'Remote',
    'fuel-cache': 'Fuel cache',
  }[stop.type] || (stop.type ? stop.type : '');

  const confMeta = {
    'live':      { color: C.forest, label: 'live'      },
    'recent':    { color: C.ochre,  label: 'recent'    },
    'estimated': { color: C.muted,  label: 'estimated' },
  }[stop.priceConfidence] || { color: C.muted, label: stop.priceConfidence || '' };

  return (
    <div style={{
      background: isCheapest ? '#F0F4EB' : C.paper,
      border: `1px solid ${isCheapest ? C.forest : C.rule}`,
      borderRadius: 12, padding: 12,
      boxShadow: isCheapest ? `0 0 0 2px ${C.forestLt}` : 'none',
      transition: 'all .2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span className="fr" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.15 }}>
              {stop.name}
            </span>
            {stop.state && (
              <span className="mono" style={{ fontSize: 10.5, color: C.muted, letterSpacing: 0.5 }}>
                {stop.state}
              </span>
            )}
            {isStart && <Pill color={C.sky}>Start</Pill>}
            {isEnd && !isStart && <Pill color={C.sky}>End</Pill>}
            {isCheapest && <Pill color={C.forest}>Best price</Pill>}
            {isDearest && <Pill color={C.rust}>Premium</Pill>}
          </div>
          <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            {Math.round(stop.distFromStartKm).toLocaleString()} km from start{typeLabel ? ` · ${typeLabel}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {stop.pricePerL != null ? (
            <>
              <div className="fr" style={{
                fontSize: 22, fontWeight: 600, lineHeight: 1,
                color: isCheapest ? C.forest : C.ink,
              }}>
                ${stop.pricePerL.toFixed(2)}
                <span className="mono" style={{
                  fontSize: 11, fontWeight: 400, color: C.muted, marginLeft: 2,
                }}>/L</span>
              </div>
              <div className="mono" style={{
                fontSize: 9, letterSpacing: 1, color: confMeta.color,
                marginTop: 3, textTransform: 'uppercase', fontWeight: 600,
              }}>
                {confMeta.label}
              </div>
            </>
          ) : (
            <div className="mono" style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>
              No price found
            </div>
          )}
        </div>
      </div>
      {stop.notes && (
        <p className="fr" style={{
          fontStyle: 'italic', fontSize: 12.5, color: C.ink2,
          margin: '8px 0 0', lineHeight: 1.4,
        }}>
          {stop.notes}
        </p>
      )}
      <button onClick={onUse}
        style={{
          marginTop: 10,
          background: 'transparent', border: `1px solid ${C.rule}`, color: C.ink,
          borderRadius: 8, padding: '5px 10px', fontSize: 11.5,
          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        }}>
        <Plus size={12}/> Log a fill-up here
      </button>
    </div>
  );
}

// =====================================================================
//  ROUTE MAP — pure SVG, no external dependencies.
//  Plots stops by lat/lng on a stylised topographic canvas. Auto-fits
//  bounds to the actual route(s). Accepts multiple routes for compare mode.
// =====================================================================
function RouteMap({ routes, height = 300 }) {
  const allStops = (routes || []).flatMap(r => (r && r.stops) || [])
    .filter(s => typeof s.lat === 'number' && typeof s.lng === 'number'
              && !isNaN(s.lat) && !isNaN(s.lng));

  if (allStops.length === 0) {
    return (
      <div style={{
        height, borderRadius: 12,
        border: `1px dashed ${C.rule}`, background: C.paper2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: C.muted, fontSize: 12.5, padding: 14, textAlign: 'center', lineHeight: 1.4,
      }}>
        No coordinates returned for this route.<br/>The map will show next search.
      </div>
    );
  }

  // Compute geographic bounds across all routes
  const lats = allStops.map(s => s.lat);
  const lngs = allStops.map(s => s.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  // Add padding to avoid stops on the edge
  const latPad = Math.max((maxLat - minLat) * 0.20, 0.5);
  const lngPad = Math.max((maxLng - minLng) * 0.20, 0.5);
  minLat -= latPad; maxLat += latPad;
  minLng -= lngPad; maxLng += lngPad;

  const VW = 800;
  const VH = 500;

  const project = (lat, lng) => {
    const x = ((lng - minLng) / (maxLng - minLng)) * VW;
    const y = ((maxLat - lat) / (maxLat - minLat)) * VH;
    return [x, y];
  };

  const legendRoutes = (routes || []).filter(r => r && r.label);
  const showLegend = legendRoutes.length > 1;

  return (
    <div style={{
      width: '100%', height,
      borderRadius: 12, overflow: 'hidden',
      border: `1px solid ${C.rule}`,
      background: C.paper2,
      position: 'relative',
    }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Topographic background pattern */}
        <defs>
          <pattern id="topo-map" x="0" y="0" width="160" height="160" patternUnits="userSpaceOnUse">
            <path d="M 0 80 Q 40 40 80 80 T 160 80" fill="none" stroke={C.rust} strokeWidth="0.6" opacity="0.4"/>
            <path d="M 0 100 Q 40 70 80 100 T 160 100" fill="none" stroke={C.rust} strokeWidth="0.5" opacity="0.35"/>
            <path d="M 0 60 Q 40 20 80 60 T 160 60" fill="none" stroke={C.rust} strokeWidth="0.4" opacity="0.3"/>
            <path d="M 0 120 Q 40 95 80 120 T 160 120" fill="none" stroke={C.rust} strokeWidth="0.4" opacity="0.3"/>
          </pattern>
        </defs>
        <rect width={VW} height={VH} fill="url(#topo-map)"/>

        {/* Routes (polylines) */}
        {(routes || []).map((route, ri) => {
          if (!route || !Array.isArray(route.stops)) return null;
          const valid = route.stops.filter(
            s => typeof s.lat === 'number' && typeof s.lng === 'number' && !isNaN(s.lat) && !isNaN(s.lng)
          );
          if (valid.length < 2) return null;
          const points = valid.map(s => project(s.lat, s.lng).join(',')).join(' ');
          const color = route.color || C.rust;
          return (
            <g key={`line-${ri}`}>
              <polyline
                points={points} fill="none"
                stroke="white" strokeWidth="6"
                strokeLinecap="round" strokeLinejoin="round"
                opacity="0.6"
              />
              <polyline
                points={points} fill="none"
                stroke={color} strokeWidth="3.5"
                strokeLinecap="round" strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Stop markers + labels */}
        {(routes || []).map((route, ri) => {
          if (!route || !Array.isArray(route.stops)) return null;
          const color = route.color || C.rust;
          const valid = route.stops.filter(
            s => typeof s.lat === 'number' && typeof s.lng === 'number' && !isNaN(s.lat) && !isNaN(s.lng)
          );
          return valid.map((stop, si) => {
            const [x, y] = project(stop.lat, stop.lng);
            const isEndpoint = si === 0 || si === valid.length - 1;
            const r = isEndpoint ? 8 : 5;
            return (
              <g key={`stop-${ri}-${si}`}>
                <circle cx={x} cy={y} r={r + 5} fill={color} opacity="0.18"/>
                <circle cx={x} cy={y} r={r} fill={color} stroke="white" strokeWidth="2"/>
                <text x={x} y={y - r - 7}
                  fontSize="11" fontWeight="600" fill={C.ink}
                  textAnchor="middle"
                  style={{ fontFamily: 'Inter Tight, system-ui, sans-serif', paintOrder: 'stroke', stroke: C.paper2, strokeWidth: 3, strokeLinejoin: 'round' }}>
                  {(stop.name || '').split(' ').slice(0, 2).join(' ')}
                </text>
                {stop.pricePerL != null && (
                  <text x={x} y={y + r + 14}
                    fontSize="10" fontWeight="700" fill={color}
                    textAnchor="middle"
                    style={{ fontFamily: 'JetBrains Mono, monospace', paintOrder: 'stroke', stroke: C.paper2, strokeWidth: 3, strokeLinejoin: 'round' }}>
                    ${Number(stop.pricePerL).toFixed(2)}
                  </text>
                )}
              </g>
            );
          });
        })}

        {/* Compass rose */}
        <g transform={`translate(${VW - 50}, 45)`}>
          <circle r="22" fill={C.paper} stroke={C.rule} strokeWidth="1.2"/>
          <path d="M 0 -15 L 5 5 L 0 1 L -5 5 Z" fill={C.rust}/>
          <text y="-3" fontSize="9" textAnchor="middle" fill={C.muted}
            fontWeight="600" style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px' }}>N</text>
        </g>

        {/* Legend (compare mode only) */}
        {showLegend && (
          <g transform={`translate(20, ${VH - 18 - (legendRoutes.length * 22)})`}>
            <rect x="-8" y="-6" width="140" height={(legendRoutes.length * 22) + 12}
              fill={C.paper} stroke={C.rule} strokeWidth="1" rx="6" opacity="0.95"/>
            {legendRoutes.map((r, i) => (
              <g key={`leg-${i}`} transform={`translate(0, ${i * 22 + 6})`}>
                <line x1="0" y1="0" x2="22" y2="0" stroke={r.color} strokeWidth="3.5" strokeLinecap="round"/>
                <text x="30" y="4" fontSize="12" fill={C.ink}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                  {r.label}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

// =====================================================================
//  COMPARISON VIEW — two routes side-by-side, plus one shared map.
// =====================================================================

function SmallStat({ label, value }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 8, padding: '7px 9px',
    }}>
      <div className="mono" style={{
        fontSize: 9, letterSpacing: 1.4, opacity: 0.6,
        textTransform: 'uppercase', lineHeight: 1.2,
      }}>
        {label}
      </div>
      <div className="fr" style={{ fontSize: 15, fontWeight: 600, marginTop: 3, lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span className="mono" style={{
      fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase',
      color: '#fff', background: color,
      padding: '2px 6px', borderRadius: 4, fontWeight: 600,
    }}>
      {children}
    </span>
  );
}

// =====================================================================
//  PAYLOAD CARD
//  Shows the live total weight of CHECKED items, with breakdowns, and a
//  deep-link to the BootKamp GVM calculator at bootkamp.co/gvm-calculator
// =====================================================================
function PayloadCard({ config, checked, hidden, custom }) {
  const { total: packedKg, byCategory, heaviestItems } = useMemo(
    () => computePayload(config, checked, hidden, custom),
    [config, checked, hidden, custom]
  );
  const plannedKg = useMemo(
    () => computePlannedPayload(config, hidden, custom),
    [config, hidden, custom]
  );
  const remaining = Math.max(0, plannedKg - packedKg);

  // Severity tint based on raw kg — purely indicative, not vehicle-specific.
  // (Real GVM math happens in the BootKamp calc, where vehicle GVM applies.)
  const heavy    = packedKg > 500;
  const moderate = packedKg > 300 && !heavy;
  const sevColor = heavy ? C.rust : moderate ? C.ochre : C.forest;
  const sevLabel = heavy ? 'Heavy load — audit GVM' : moderate ? 'Substantial — worth checking' : 'Lean kit so far';

  const gvmUrl = 'https://bootkamp.co/gvm-calculator';

  // top categories with weight, capped at 4 visible
  const catRows = byCategory.filter(c => c.kg > 0).slice(0, 4);
  const maxCatKg = catRows[0]?.kg || 1;

  return (
    <section style={{
      background: C.ink, color: C.bg,
      borderRadius: 14, marginBottom: 18,
      overflow: 'hidden', position: 'relative',
    }}>
      {/* topographic decoration on dark */}
      <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.08, pointerEvents: 'none' }}>
        <defs>
          <pattern id="topo-dark" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M 0 110 Q 55 60 110 110 T 220 110" fill="none" stroke={C.bg} strokeWidth="0.8"/>
            <path d="M 0 140 Q 55 95 110 140 T 220 140" fill="none" stroke={C.bg} strokeWidth="0.6"/>
            <path d="M 0 80 Q 55 30 110 80 T 220 80" fill="none" stroke={C.bg} strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#topo-dark)"/>
      </svg>

      <div style={{ position: 'relative', zIndex: 1, padding: 18 }}>
        {/* Headline number */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div>
            <div className="mono" style={{ fontSize: 11, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' }}>
              Packed so far
            </div>
            <div className="fr" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1, marginTop: 2 }}>
              {packedKg}<span style={{ fontSize: 20, opacity: 0.5, marginLeft: 4 }}>kg</span>
            </div>
          </div>
          <div style={{
            background: sevColor, color: '#fff',
            padding: '4px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
            whiteSpace: 'nowrap', alignSelf: 'flex-start',
          }}>
            {sevLabel}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, letterSpacing: 1, opacity: 0.55, textTransform: 'uppercase', marginBottom: 14 }}>
          {remaining} kg still on the list · {plannedKg} kg if you pack it all
        </div>

        {/* Category breakdown — only shows when there's weight to show */}
        {catRows.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 1.8, opacity: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
              By section
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {catRows.map(c => {
                const w = Math.max(2, Math.round((c.kg / maxCatKg) * 100));
                const tColor = ({
                  forest: '#7FA48B', rust: '#E58A5F', ochre: '#E2B96A',
                  sky: '#8BB0C3', ink: '#C2B8A4',
                }[c.tint]) || '#C2B8A4';
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, lineHeight: 1.2, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.title}
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${w}%`, height: '100%', background: tColor, transition: 'width .3s ease' }} />
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: 12, opacity: 0.85, minWidth: 52, textAlign: 'right' }}>
                      {Math.round(c.kg)} kg
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Heaviest individual items (where your kg is hiding) */}
        {heaviestItems.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid rgba(255,255,255,0.08)`,
            borderRadius: 10, padding: '10px 12px', marginBottom: 14,
          }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 1.8, opacity: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
              Heaviest items
            </div>
            {heaviestItems.map(it => (
              <div key={it.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, marginTop: 3 }}>
                <span style={{ flex: 1, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.name}
                </span>
                <span className="mono" style={{ opacity: 0.7, fontSize: 11 }}>{it.cat}</span>
                <span className="mono" style={{ fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
                  {Math.round(it.kg * 10) / 10} kg
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="fr" style={{ fontStyle: 'italic', fontSize: 13.5, lineHeight: 1.45, opacity: 0.85, margin: '0 0 12px' }}>
          {config.csr
            ? "On the Canning, weight is the limiting factor. Fuel and water alone account for most of your load — every kilo of gear after that comes out of your safety margin."
            : "This is the live weight of what you've ticked. It excludes passengers and the rig itself. To see how it lands against your vehicle's GVM, run the BootKamp calculator."}
        </p>

        <a href={gvmUrl} target="_blank" rel="noopener noreferrer"
           className="lift"
           style={{
             display: 'inline-flex', alignItems: 'center', gap: 8,
             background: C.rust, color: C.bg,
             padding: '10px 14px', borderRadius: 10,
             fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
             border: `1px solid ${C.rustDk}`,
           }}>
          <Truck size={15}/>
          Check your remaining GVM
          <span style={{ opacity: 0.7, fontSize: 12, marginLeft: 4 }}>↗</span>
        </a>

        <div className="mono" style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.5, marginTop: 10, textTransform: 'uppercase' }}>
          bootkamp.co/gvm-calculator · opens in new tab
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: `1px solid rgba(255,255,255,0.1)`,
      borderRadius: 10, padding: '8px 10px',
    }}>
      <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.5, opacity: 0.6, textTransform: 'uppercase' }}>{label}</div>
      <div className="fr" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// =====================================================================
//  PRIMITIVES
// =====================================================================
function Label({ children }) {
  return <div className="mono" style={{ fontSize: 10, letterSpacing: 2, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>{children}</div>;
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} className="lift"
      style={{
        background: active ? C.ink : 'transparent',
        color: active ? C.bg : C.ink,
        border: `1px solid ${active ? C.ink : C.rule}`,
        borderRadius: 999, padding: '6px 12px', fontSize: 12.5,
        whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

function Stepper({ label, value, min, max, onChange }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.rule}`, borderRadius: 10, padding: '8px 10px' }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={dec} aria-label={`Decrease ${label}`}
          style={{ background: 'transparent', border: `1px solid ${C.rule}`, color: C.ink, width: 26, height: 26, borderRadius: 6, display:'grid', placeItems:'center' }}>
          −
        </button>
        <div className="fr" style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
        <button onClick={inc} aria-label={`Increase ${label}`}
          style={{ background: C.ink, border: `1px solid ${C.ink}`, color: C.bg, width: 26, height: 26, borderRadius: 6, display:'grid', placeItems:'center' }}>
          +
        </button>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        width: 32, height: 32, borderRadius: 8,
        border: `1px solid ${C.rule}`, background: C.paper, color: C.ink,
        display: 'grid', placeItems: 'center',
      }}>
      {children}
    </button>
  );
}

// =====================================================================
//  CREW VIEW — shared packing list via Supabase realtime
//  Added on top of v1 — everything else in this file is unchanged.
// =====================================================================
function CrewView({ categories, crewTrip, setCrewTrip, flash }) {
  const [myName, setMyName] = useState(() => {
    try { return localStorage.getItem('fm_crew_name') || ''; } catch { return ''; }
  });
  const [nameInput, setNameInput]     = useState('');
  const [tripInput, setTripInput]     = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [claims, setClaims]           = useState([]);
  const [loading, setLoading]         = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [view, setView]               = useState(crewTrip ? 'active' : 'lobby');
  const subRef = useRef(null);

  const saveName = (name) => {
    setMyName(name);
    try { localStorage.setItem('fm_crew_name', name); } catch {}
  };

  const fetchClaims = useCallback(async (tripId) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('claims').select('*').eq('trip_id', tripId);
    if (!error && data) setClaims(data);
  }, []);

  const subscribe = useCallback((tripId) => {
    if (!supabase) return;
    if (subRef.current) subRef.current.unsubscribe();
    subRef.current = supabase
      .channel(`claims:${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims', filter: `trip_id=eq.${tripId}` },
        () => fetchClaims(tripId))
      .subscribe();
  }, [fetchClaims]);

  // On mount: reconnect to existing trip if we have one
  useEffect(() => {
    if (crewTrip) {
      setView('active');
      fetchClaims(crewTrip.id);
      subscribe(crewTrip.id);
    }
    return () => { if (subRef.current) subRef.current.unsubscribe(); };
  }, []);

  const createTrip = async () => {
    if (!supabase) { flash('Supabase not configured — add env vars and redeploy.'); return; }
    const name = (myName || nameInput).trim();
    if (!name) { flash('Enter your name first'); return; }
    if (!newTripName.trim()) { flash('Give the trip a name'); return; }
    saveName(name);
    setLoading(true);
    const code = generateTripCode();
    const { error } = await supabase.from('trips').insert({ id: code, name: newTripName.trim() });
    if (error) { flash('Could not create trip — try again'); setLoading(false); return; }
    const trip = { id: code, name: newTripName.trim() };
    setCrewTrip(trip);
    subscribe(code);
    setClaims([]);
    setView('active');
    setLoading(false);
    flash(`Trip created — share the code: ${code}`);
  };

  const joinTrip = async () => {
    if (!supabase) { flash('Supabase not configured — add env vars and redeploy.'); return; }
    const name = (myName || nameInput).trim();
    if (!name) { flash('Enter your name first'); return; }
    const code = tripInput.trim().toUpperCase();
    if (code.length !== 6) { flash('Enter the 6-character trip code'); return; }
    saveName(name);
    setLoading(true);
    const { data, error } = await supabase.from('trips').select('*').eq('id', code).single();
    if (error || !data) { flash(`No trip found with code ${code}`); setLoading(false); return; }
    setCrewTrip(data);
    await fetchClaims(code);
    subscribe(code);
    setView('active');
    setLoading(false);
    flash(`Joined: ${data.name}`);
  };

  const claimItem = async (itemId, itemName, category) => {
    if (!supabase || !crewTrip) return;
    setSyncing(true);
    const name = myName.trim();
    const existing = claims.find(c => c.item_id === itemId);
    if (existing) {
      await supabase.from('claims').update({ claimed_by: name, claimed_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('claims').insert({ trip_id: crewTrip.id, item_id: itemId, item_name: itemName, category, claimed_by: name });
    }
    await fetchClaims(crewTrip.id);
    setSyncing(false);
  };

  const releaseClaim = async (itemId) => {
    if (!supabase || !crewTrip) return;
    setSyncing(true);
    const existing = claims.find(c => c.item_id === itemId);
    if (existing) await supabase.from('claims').delete().eq('id', existing.id);
    await fetchClaims(crewTrip.id);
    setSyncing(false);
  };

  const leaveTrip = () => {
    if (subRef.current) subRef.current.unsubscribe();
    setCrewTrip(null);
    setClaims([]);
    setView('lobby');
    flash('Left the trip');
  };

  const copyCode = () => {
    navigator.clipboard.writeText(crewTrip.id).catch(() => {});
    flash('Code copied!');
  };

  // Flat list of all visible items with category info
  const allItems = useMemo(() => {
    const rows = [];
    for (const cat of categories) {
      const items = [...cat.items, ...(cat.extraItems || [])];
      for (const item of items) rows.push({ id: item.id, name: item.name, category: cat.title, tint: cat.tint, icon: cat.icon });
    }
    return rows;
  }, [categories]);

  const claimMap = useMemo(() => {
    const m = {};
    for (const c of claims) m[c.item_id] = c.claimed_by;
    return m;
  }, [claims]);

  const groupedItems = useMemo(() => {
    const groups = {};
    for (const item of allItems) {
      if (!groups[item.category]) groups[item.category] = { title: item.category, tint: item.tint, icon: item.icon, items: [] };
      groups[item.category].items.push({ ...item, claimer: claimMap[item.id] || null });
    }
    return Object.values(groups);
  }, [allItems, claimMap]);

  const [crewOpen, setCrewOpen] = useState({});

  const shareTrip = () => {
    const msg = `Join my Field Manifest trip "${crewTrip.name}" — use code: ${crewTrip.id}`;
    if (navigator.share) {
      navigator.share({ title: 'Join my Field Manifest trip', text: msg }).catch(() => {});
    } else {
      navigator.clipboard.writeText(msg).catch(() => {});
      flash('Invite copied — paste it into your group chat');
    }
  };

  // Deterministic colour per person name
  const personColor = (name) => {
    const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    return `hsl(${hue},50%,32%)`;
  };
  const personBg = (name) => {
    const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    return `hsl(${hue},40%,92%)`;
  };

  // ── LOBBY ──────────────────────────────────────────────────────────
  if (view === 'lobby' || !crewTrip) {
    return (
      <div className="grow-in">

        {/* Hero card */}
        <section style={{ background: C.ink, color: C.bg, borderRadius: 14, marginBottom: 14, overflow: 'hidden', position: 'relative' }}>
          <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.07, pointerEvents: 'none' }}>
            <defs>
              <pattern id="topo-crew-lobby" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
                <path d="M 0 110 Q 55 60 110 110 T 220 110" fill="none" stroke={C.bg} strokeWidth="0.8"/>
                <path d="M 0 140 Q 55 95 110 140 T 220 140" fill="none" stroke={C.bg} strokeWidth="0.6"/>
                <path d="M 0 80 Q 55 30 110 80 T 220 80" fill="none" stroke={C.bg} strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#topo-crew-lobby)"/>
          </svg>
          <div style={{ position: 'relative', padding: 18 }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' }}>Crew sync</div>
            <div className="fr" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.15, marginTop: 4 }}>
              Share the load.<br/>Don't bring two tents.
            </div>
            <p className="fr" style={{ fontStyle: 'italic', fontSize: 13, opacity: 0.8, marginTop: 8, lineHeight: 1.5, margin: '8px 0 0' }}>
              Create a trip and share the code. Everyone claims what they're bringing — live.
            </p>
          </div>
        </section>

        {/* Name */}
        <section style={{ background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
          <Label>Your name</Label>
          <input
            value={myName || nameInput}
            onChange={e => { setNameInput(e.target.value); setMyName(e.target.value); }}
            placeholder="e.g. Vaughan"
            style={{ width: '100%', marginTop: 6, padding: '9px 12px', border: `1px solid ${C.rule}`, borderRadius: 9, fontFamily: "'Fraunces', serif", fontSize: 16, background: C.bg, color: C.ink, outline: 'none' }}
          />
        </section>

        {/* Create */}
        <section style={{ background: C.paper, border: `1px solid ${C.rule}`, borderLeft: `4px solid ${C.forest}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: C.forest, marginBottom: 10 }}>Create a new shared trip</div>
          <Label>Trip name</Label>
          <input
            value={newTripName}
            onChange={e => setNewTripName(e.target.value)}
            placeholder="e.g. Simpson Desert 2025"
            style={{ width: '100%', margin: '4px 0 12px', padding: '9px 12px', border: `1px solid ${C.rule}`, borderRadius: 9, fontFamily: 'inherit', fontSize: 14, background: C.bg, color: C.ink, outline: 'none' }}
          />
          <button onClick={createTrip} disabled={loading} className="lift"
            style={{ width: '100%', padding: 12, background: C.forest, color: C.bg, border: 'none', borderRadius: 10, fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Plus size={15}/>{loading ? 'Creating…' : 'Create trip & get code'}
          </button>
        </section>

        {/* Join */}
        <section style={{ background: C.paper, border: `1px solid ${C.rule}`, borderLeft: `4px solid ${C.rust}`, borderRadius: 14, padding: 16 }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: C.rust, marginBottom: 10 }}>Join an existing trip</div>
          <Label>6-character trip code</Label>
          <input
            value={tripInput}
            onChange={e => setTripInput(e.target.value.toUpperCase())}
            placeholder="e.g. KBMPQR"
            maxLength={6}
            style={{ width: '100%', margin: '4px 0 12px', padding: '9px 12px', border: `1px solid ${C.rule}`, borderRadius: 9, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: 5, background: C.bg, color: C.ink, outline: 'none', textTransform: 'uppercase' }}
          />
          <button onClick={joinTrip} disabled={loading} className="lift"
            style={{ width: '100%', padding: 12, background: C.rust, color: C.bg, border: 'none', borderRadius: 10, fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <ArrowRight size={15}/>{loading ? 'Joining…' : 'Join trip'}
          </button>
        </section>
      </div>
    );
  }


  // ── ACTIVE TRIP ────────────────────────────────────────────────────
  const totalItems   = allItems.length;
  const claimedCount = claims.length;
  const myCount      = claims.filter(c => c.claimed_by === myName).length;
  const uniquePeople = [...new Set(claims.map(c => c.claimed_by))];

  return (
    <div className="grow-in">

      {/* Trip header */}
      <section style={{ background: C.ink, color: C.bg, borderRadius: 14, marginBottom: 14, overflow: 'hidden', position: 'relative' }}>
        <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.07, pointerEvents: 'none' }}>
          <defs>
            <pattern id="topo-crew-active" x="0" y="0" width="220" height="220" patternUnits="userSpaceOnUse">
              <path d="M 0 110 Q 55 60 110 110 T 220 110" fill="none" stroke={C.bg} strokeWidth="0.8"/>
              <path d="M 0 80 Q 55 30 110 80 T 220 80" fill="none" stroke={C.bg} strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#topo-crew-active)"/>
        </svg>
        <div style={{ position: 'relative', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' }}>Active crew trip</div>
              <div className="fr" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1, marginTop: 4 }}>{crewTrip.name}</div>
            </div>
            <button onClick={copyCode}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '8px 12px', color: C.bg, cursor: 'pointer', flexShrink: 0, textAlign: 'center' }}>
              <div className="mono" style={{ fontSize: 20, letterSpacing: 4, fontWeight: 600 }}>{crewTrip.id}</div>
              <div className="mono" style={{ fontSize: 9, opacity: 0.55, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>tap to copy</div>
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14 }}>
            {[['Items', totalItems], ['Claimed', claimedCount], ['Mine', myCount]].map(([label, val]) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 12px' }}>
                <div className="mono" style={{ fontSize: 9, letterSpacing: 1.5, opacity: 0.6, textTransform: 'uppercase' }}>{label}</div>
                <div className="fr" style={{ fontSize: 22, fontWeight: 600, marginTop: 3 }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Invite crew — prominent rust button */}
      <button onClick={shareTrip} className="lift"
        style={{
          width: '100%', padding: 13, marginBottom: 10,
          background: C.rust, color: C.bg, border: 'none', borderRadius: 12,
          fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
        }}>
        <Users size={16}/> Invite crew — share trip code
      </button>

      {/* You + refresh + leave */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ flex: 1, background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserCheck size={14} color={C.muted}/>
          <span className="mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.muted }}>You:</span>
          <span className="fr" style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{myName}</span>
          {syncing && <span className="mono" style={{ fontSize: 10, color: C.muted, marginLeft: 'auto' }}>syncing…</span>}
        </div>
        <button onClick={() => fetchClaims(crewTrip.id)} title="Refresh" className="lift"
          style={{ padding: '8px 10px', background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 10, cursor: 'pointer', color: C.muted, display: 'grid', placeItems: 'center' }}>
          <RefreshCw size={15}/>
        </button>
        <button onClick={leaveTrip} title="Leave trip" className="lift"
          style={{ padding: '8px 10px', background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 10, cursor: 'pointer', color: C.muted, display: 'grid', placeItems: 'center' }}>
          <X size={15}/>
        </button>
      </div>

      {/* Crew legend */}
      {uniquePeople.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {uniquePeople.map(p => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: personBg(p), color: personColor(p), borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
              {p} · {claims.filter(c => c.claimed_by === p).length} items
            </span>
          ))}
        </div>
      )}

      {/* Categories — collapsible with colour-coded icons matching Pack tab */}
      {groupedItems.map(group => {
        const t = tintFor(group.tint);
        const Icon = group.icon;
        const isOpen = crewOpen[group.title] !== false;
        const groupClaimed = group.items.filter(i => i.claimer).length;
        const pct = group.items.length ? Math.round((groupClaimed / group.items.length) * 100) : 0;

        return (
          <section key={group.title} style={{ background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>

            <button onClick={() => setCrewOpen(prev => ({ ...prev, [group.title]: !isOpen }))}
              style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: t.bg, color: t.dark, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {Icon && <Icon size={18}/>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div className="fr" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.1 }}>{group.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: C.muted }}>{groupClaimed}/{group.items.length}</div>
                </div>
              </div>
              <ChevronDown size={18} style={{ color: C.muted, transition: 'transform .2s ease', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }}/>
            </button>

            <div style={{ height: 2, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, background: C.paper2 }}/>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: t.fg, transition: 'width .3s ease' }}/>
            </div>

            {isOpen && group.items.map(item => {
              const isMine    = item.claimer === myName;
              const isClaimed = !!item.claimer;
              return (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px', borderTop: `1px solid ${C.rule}`,
                  background: isMine ? t.bg : 'transparent',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: C.ink, fontWeight: isMine ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </div>
                    {item.claimer && (
                      <div style={{ marginTop: 3 }}>
                        <span style={{ background: personBg(item.claimer), color: personColor(item.claimer), padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                          {item.claimer}
                        </span>
                      </div>
                    )}
                  </div>
                  {isClaimed ? (
                    <button onClick={() => isMine ? releaseClaim(item.id) : claimItem(item.id, item.name, group.title)}
                      className="lift"
                      style={{ padding: '5px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', flexShrink: 0, background: isMine ? t.fg : C.rustLt, color: isMine ? C.bg : C.rustDk }}>
                      {isMine ? '✓ Mine' : 'Take it'}
                    </button>
                  ) : (
                    <button onClick={() => claimItem(item.id, item.name, group.title)}
                      className="lift"
                      style={{ padding: '5px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: C.paper2, border: `1px solid ${C.rule}`, color: C.ink2, flexShrink: 0 }}>
                      I'll bring it
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      <footer style={{ marginTop: 28, paddingTop: 18, borderTop: `1px solid ${C.rule}` }}>
        <p className="fr" style={{ fontStyle: 'italic', color: C.muted, fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>
          Share the trip code with your crew. Everyone joins, taps what they're bringing. No duplicate tents.
        </p>
      </footer>
    </div>
  );
}
