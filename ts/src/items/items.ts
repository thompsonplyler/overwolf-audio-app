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
    wisp: 850,
    alt: 1100,
    banshees: 3000,
    shadowflame: 3200,
    verdant: 1600,
    codex: 850,
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
};

export const ITEM_PRIORITY: ItemDef[] = [
    ITEMS.LICH_BANE,
    ITEMS.RABADONS,
    ITEMS.BANSHEES,
    ITEMS.ZHONYAS,
    ITEMS.SHADOWFLAME,
    ITEMS.VOID_STAFF,
];

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

// WebSocket emit mapping helper for future extensibility
export interface PurchaseEventMapping {
    [itemId: number]: string; // item id -> short event name
}

export const DEFAULT_PURCHASE_EVENT_MAP: PurchaseEventMapping = {
    3089: 'rabadon',
};

