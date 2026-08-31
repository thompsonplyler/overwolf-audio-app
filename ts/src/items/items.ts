// Item and component modeling with a registry and helpers

export interface ItemComponentDef {
    id: number;
    cost: number;
}

export interface ItemDef {
    id: number;
    name: string;
    cost: number;
    components: ItemComponentDef[];
    audioCue: string;
    requiresComponentCheck: boolean;
    /** Distinct component types that must be owned before this item is a target-check
     * candidate at all (default 1). Only needed for an item that shares components across
     * more than one otherwise-unrelated branch — e.g. Cosmic Drive shares Aether Wisp with
     * Lich Bane/Storm Surge AND Fiendish Codex with Banshee's Veil, so owning just one
     * incidental shared component (bought for a *different* item) must not make it a
     * candidate on its own. */
    minOwnedComponents?: number;
}

export const PRICE = {
    lichbane: 2900,
    rabadons: 3500,
    void: 3000,
    zhonyas: 3250,
    armguard: 1600,
    jewel: 1100,
    wand: 850,
    rod: 1200,
    sheen: 900,
    wisp: 900, // Aether Wisp -- was 850, wiki-confirmed 2026-07-30 as 900 (Sheen 900 + Aether Wisp 900 + Blasting Wand 850 + 250 combine = Lich Bane's 2900)
    alt: 1100,
    banshees: 3000,
    shadowflame: 3200,
    verdant: 1600,
    codex: 850,
    seal: 350,
    mejais: 1500,
    stormsurge: 2800,
    kindlegem: 800, // wiki-confirmed 2026-08-08
    cosmicdrive: 3000 // wiki-confirmed 2026-08-08
};

export const COMPONENTS = {
    NEEDLESSLY_LARGE_ROD: { id: 1058, cost: PRICE.rod },
    SHEEN: { id: 3057, cost: PRICE.sheen },
    AETHER_WISP: { id: 3113, cost: PRICE.wisp },
    FIENDISH_CODEX: { id: 3108, cost: PRICE.codex },
    SEEKERS_ARMGUARD: { id: 2420, cost: PRICE.armguard },
    BLIGHTING_JEWEL: { id: 4630, cost: PRICE.jewel },
    BLASTING_WAND: { id: 1026, cost: PRICE.wand },
    HEXTECH_ALTERNATOR: { id: 3145, cost: PRICE.alt },
    VERDANT_BARRIER: { id: 4632, cost: PRICE.verdant },
    DARK_SEAL: { id: 1082, cost: PRICE.seal },
    KINDLEGEM: { id: 3067, cost: PRICE.kindlegem }
} as const;

export const ITEMS: Record<string, ItemDef> = {
    LICH_BANE: {
        id: 3100, name: 'Lich Bane', cost: PRICE.lichbane,
        components: [COMPONENTS.SHEEN, COMPONENTS.AETHER_WISP, COMPONENTS.BLASTING_WAND],
        audioCue: 'getlichbane.mp3', requiresComponentCheck: true,
    },
    RABADONS: {
        id: 3089, name: "Rabadon's Deathcap", cost: PRICE.rabadons,
        components: [COMPONENTS.NEEDLESSLY_LARGE_ROD, COMPONENTS.NEEDLESSLY_LARGE_ROD],
        audioCue: 'getrabadons.mp3', requiresComponentCheck: true,
    },
    BANSHEES: {
        id: 3102, name: "Banshee's Veil", cost: PRICE.banshees,
        components: [COMPONENTS.VERDANT_BARRIER, COMPONENTS.FIENDISH_CODEX],
        audioCue: 'getbanshees.mp3', requiresComponentCheck: true,
    },
    ZHONYAS: {
        id: 3157, name: "Zhonya's Hourglass", cost: PRICE.zhonyas,
        components: [COMPONENTS.SEEKERS_ARMGUARD, COMPONENTS.NEEDLESSLY_LARGE_ROD],
        audioCue: 'getzhonyas.mp3', requiresComponentCheck: true,
    },
    SHADOWFLAME: {
        id: 4645, name: "Shadowflame", cost: PRICE.shadowflame,
        components: [COMPONENTS.HEXTECH_ALTERNATOR, COMPONENTS.NEEDLESSLY_LARGE_ROD],
        audioCue: 'getshadowflame.mp3', requiresComponentCheck: true,
    },
    VOID_STAFF: {
        id: 3135, name: 'Void Staff', cost: PRICE.void,
        components: [COMPONENTS.BLIGHTING_JEWEL, COMPONENTS.BLASTING_WAND],
        audioCue: 'getvoidstaff.mp3', requiresComponentCheck: true,
    },
    STORMSURGE: {
        id: 4646, name: 'Storm Surge', cost: PRICE.stormsurge,
        components: [COMPONENTS.HEXTECH_ALTERNATOR, COMPONENTS.AETHER_WISP],
        audioCue: 'getstormsurge.mp3', requiresComponentCheck: true
    },
    COSMIC_DRIVE: {
        id: 4629, name: 'Cosmic Drive', cost: PRICE.cosmicdrive,
        components: [COMPONENTS.KINDLEGEM, COMPONENTS.AETHER_WISP, COMPONENTS.FIENDISH_CODEX],
        audioCue: 'getcosmicdrive.mp3', requiresComponentCheck: true, minOwnedComponents: 2
    }
};

// Priority order on shared-component branches (earlier = higher priority — see
// shouldDeferToHigherPriorityItem). Cosmic Drive sits between Lich Bane and Storm
// Surge on the Aether Wisp branch; Shadowflame sits above Zhonya's on the
// Needlessly Large Rod branch (both requested 2026-08-08).
export const ITEM_PRIORITY: ItemDef[] = [
    ITEMS.LICH_BANE,
    ITEMS.COSMIC_DRIVE,
    ITEMS.STORMSURGE,
    ITEMS.RABADONS,
    ITEMS.BANSHEES,
    ITEMS.SHADOWFLAME,
    ITEMS.ZHONYAS,
    ITEMS.VOID_STAFF,
];

/** Component ids required by an item (multiset). */
export function getItemComponentIds(item: ItemDef): Set<number> {
    const ids = new Set<number>();
    for (const comp of item.components) {
        ids.add(comp.id);
    }
    return ids;
}

export function itemsShareComponent(a: ItemDef, b: ItemDef): boolean {
    const bIds = getItemComponentIds(b);
    for (const id of getItemComponentIds(a)) {
        if (bIds.has(id)) return true;
    }
    return false;
}

/**
 * True when a higher-priority item shares components with `candidate`, the player is on that
 * branch (owns any of its components), does not own the finished item, and cannot afford it yet
 * while `candidate` is affordable — so we should not cue the lower-priority item.
 */
export function shouldDeferToHigherPriorityItem(
    candidate: ItemDef,
    ownedCounts: Map<number, number>,
    playerGold: number
): boolean {
    const candidateIndex = ITEM_PRIORITY.findIndex(i => i.id === candidate.id);
    if (candidateIndex <= 0) return false;

    const candidateRemaining = calculateRemainingCost(candidate, ownedCounts);
    const candidateAffordable = playerGold >= candidateRemaining;
    if (!candidateAffordable) return false;

    for (let i = 0; i < candidateIndex; i++) {
        const higher = ITEM_PRIORITY[i];
        if (!itemsShareComponent(higher, candidate)) continue;
        if ((ownedCounts.get(higher.id) || 0) > 0) continue;

        const onHigherBranch = higher.components.some(c => (ownedCounts.get(c.id) || 0) > 0);
        if (!onHigherBranch) continue;

        const higherRemaining = calculateRemainingCost(higher, ownedCounts);
        const higherAffordable = playerGold >= higherRemaining;
        if (!higherAffordable) {
            return true;
        }
    }
    return false;
}

export function calculateRemainingCost(item: ItemDef, ownedCounts: Map<number, number>): number {
    let remainingCost = item.cost;
    const required: Map<number, number> = new Map();
    for (const comp of item.components) {
        required.set(comp.id, (required.get(comp.id) || 0) + 1);
    }
    let discount = 0;
    for (const [compId, reqCount] of required.entries()) {
        const owned = ownedCounts.get(compId) || 0;
        const used = Math.min(reqCount, owned);
        const compCost = item.components.find(c => c.id === compId)?.cost || 0;
        if (compCost > 0) {
            discount += used * compCost;
        }
    }
    remainingCost -= discount;
    return remainingCost;
}

// WebSocket emit mapping: item id -> short event name.
// Membership in this map is the opt-in for once-per-match WS emissions of the form
// { op: "event", name: "<value>" }. Items tracked elsewhere (audio cues, etc.)
// that are absent from this map will NOT produce a WS signal.
export interface PurchaseEventMapping {
    [itemId: number]: string;
}

export const DEFAULT_PURCHASE_EVENT_MAP: PurchaseEventMapping = {
    3089: 'rabadon',
    3100: 'lichbane',
    3102: 'banshees',
    3041: 'mejais',
    3157: 'zhonyas',
    4646: 'stormsurge',
    3135: 'voidstaff',
    4629: 'cosmicdrive'
    // 4645: 'shadowflame',
};

// Mejai's Soulstealer stack tracking (Glory passive). Riot wiki-confirmed rates,
// verified 2026-07-30 -- there is no API field exposing stack count directly
// (see the existing maybeDumpFullLiveGameInfo debug dump in in_game.ts, built
// specifically to check for this and find nothing), so it's derived entirely
// from kill/assist/death counting, gated on owning Dark Seal/Mejai's.
export const MEJAI_SOULSTEALER_ITEM_ID = 3041; // = DEFAULT_PURCHASE_EVENT_MAP's 'mejais' key
export const DARK_SEAL_ITEM_ID = COMPONENTS.DARK_SEAL.id; // 1082

export type MejaiTier = 'dark_seal' | 'mejais';

export const MEJAI_STACK_RATES: Record<MejaiTier, { perKill: number; perAssist: number; lossOnDeath: number; max: number }> = {
    dark_seal: { perKill: 2, perAssist: 1, lossOnDeath: 5, max: 10 },
    mejais: { perKill: 4, perAssist: 2, lossOnDeath: 10, max: 25 },
};

