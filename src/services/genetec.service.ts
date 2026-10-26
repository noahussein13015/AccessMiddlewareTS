import { XMLParser } from 'fast-xml-parser';

export interface TwicCardPayload {
    card_id: string;
    gate_id: string | null;
    reader_id: string | null;
    confidence: number | null;
    read_time: string | null;
    access: string;
    denied_reason: string | null;
    need_appointment: string | null;
    cardholder_name: string | null;
    valid_until: string | null;
    groups: string[];
    company: string;
    guid?: string;
    cardholder_guid?: string;
    state?: string;
}

export class GenetecService {
    private baseUrl: string;
    private authHeader: string;
    private parser: XMLParser;
    private gateId: string | null;

    private static cachedGroupMap: Map<string, string[]> | null = null;
    private static lastGroupMapFetch: number = 0;
    private static groupMapPromise: Promise<Map<string, string[]>> | null = null;

    constructor(baseUrl: string, username: string, appId: string, password: string, gateId?: string) {
        this.baseUrl = baseUrl;
        this.gateId = gateId || null;
        this.parser = new XMLParser({ 
            ignoreAttributes: false, 
            attributeNamePrefix: "",
            isArray: (name) => {
                if (name === "Row" || name === "Cell" || name === "item" || name === "KeyValuePairOfSystemStringSystemString" || name === "KeyValuePairOfSystem.StringSystem.String") return true;
                return false;
            }
        });

        const authString = `${username};${appId}:${password}`;
        const authBase64 = Buffer.from(authString).toString('base64');
        this.authHeader = `Basic ${authBase64}`;
    }

    private async getXml(endpoint: string): Promise<string> {
        const url = `${this.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': this.authHeader,
                'User-Agent': 'AccessMiddleware/1.0'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur Genetec API [${response.status}] : ${errorText}`);
        }

        return await response.text();
    }

    private findAllRows(obj: any, rows: any[] = []): any[] {
        if (!obj || typeof obj !== 'object') return rows;
        for (const key of Object.keys(obj)) {
            if (key === 'Row') {
                const val = obj[key];
                if (Array.isArray(val)) {
                    rows.push(...val);
                } else {
                    rows.push(val);
                }
            } else {
                this.findAllRows(obj[key], rows);
            }
        }
        return rows;
    }

    // Équivalent du Descendants() de C# pour fouiller partout dans l'objet parsé
    private findAllElements(obj: any, tagName: string, matches: any[] = []): any[] {
        if (!obj || typeof obj !== 'object') return matches;
        for (const key of Object.keys(obj)) {
            if (key.toLowerCase() === tagName.toLowerCase()) {
                const val = obj[key];
                if (Array.isArray(val)) {
                    matches.push(...val);
                } else {
                    matches.push(val);
                }
            } else {
                this.findAllElements(obj[key], tagName, matches);
            }
        }
        return matches;
    }

    public async getCardholderDetails(cardholderGuid: string): Promise<{ name: string; company: string }> {
        try {
            const xml = await this.getXml(`/entity?q=entity=${cardholderGuid},Name,CustomFields`);
            const jsonObj = this.parser.parse(xml);

            const root = jsonObj?.rsp;
            const name = root?.Name || "Inconnu";

            let company = "";
            const customFieldsContainer = root?.CustomFields?.item;
            if (customFieldsContainer) {
                const valuesArray = Array.isArray(customFieldsContainer) ? customFieldsContainer : [customFieldsContainer];
                
                for (const item of valuesArray) {
                    const cfValue = item?.CustomFieldValue;
                    if (cfValue) {
                        const fieldName = cfValue.Name || cfValue?.CustomField?.Name || "";
                        if (fieldName.toLowerCase().includes("société") || fieldName.toLowerCase().includes("societe")) {
                            company = cfValue.Value || "";
                            break;
                        }
                    }
                }
            }

            return { name, company };
        } catch (error) {
            console.warn(`⚠️ Échec de récupération des détails pour le porteur ${cardholderGuid}`, error);
            return { name: "Inconnu", company: "" };
        }
    }

    public async getCredentialMetaData(credentialGuid: string): Promise<{ cardholderGuid?: string; expirationDate?: string }> {
        try {
            const xml = await this.getXml(`/entity?q=entity=${credentialGuid},CardholderGuid,ExpirationDate`);
            const jsonObj = this.parser.parse(xml);
            const root = jsonObj?.rsp;
            return {
                cardholderGuid: root?.CardholderGuid,
                expirationDate: root?.ExpirationDate
            };
        } catch (error) {
            console.warn(`⚠️ Échec de récupération des métadonnées pour la credential ${credentialGuid}`, error);
            return {};
        }
    }

    private async getOrBuildCardholderToGroupsMap(): Promise<Map<string, string[]>> {
        const now = Date.now();
        const ttl = 15 * 60 * 1000;

        if (GenetecService.cachedGroupMap && (now - GenetecService.lastGroupMapFetch) < ttl) {
            return GenetecService.cachedGroupMap;
        }

        if (!GenetecService.groupMapPromise) {
            GenetecService.groupMapPromise = (async () => {
                try {
                    const map = await this.buildCardholderToGroupsMap();
                    GenetecService.cachedGroupMap = map;
                    GenetecService.lastGroupMapFetch = Date.now();
                    return map;
                } finally {
                    GenetecService.groupMapPromise = null;
                }
            })();
        }

        return await GenetecService.groupMapPromise;
    }

    private async buildCardholderToGroupsMap(): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        try {
            const listXml = await this.getXml('/report/EntityConfiguration?q=EntityTypes@CardholderGroup');
            const listObj = this.parser.parse(listXml);

            const rowsArray = this.findAllRows(listObj);
            const groupGuids: string[] = [];

            for (const row of rowsArray) {
                const cells = row.Cell || [];
                const cellsArray = Array.isArray(cells) ? cells : [cells];
                const guidCell = cellsArray.find((c: any) => c.name === "Guid" || c.Name === "Guid");
                const guidValue = guidCell?.text || guidCell?.['#text'] || guidCell?.Value;
                if (guidValue) {
                    groupGuids.push(guidValue);
                }
            }

            for (const groupGuid of groupGuids) {
                try {
                    const groupXml = await this.getXml(`/entity?q=entity=${groupGuid},Name,Members`);
                    const groupObj = this.parser.parse(groupXml);
                    const root = groupObj?.rsp;
                    const groupName = root?.Name;

                    if (!groupName) continue;

                    const items = this.findAllItems(root?.Members);
                    for (const item of items) {
                        const memberGuid = item?.Guid;
                        if (memberGuid && typeof memberGuid === 'string') {
                            const cleanGuid = memberGuid.replace(/-/g, "").toLowerCase();
                            if (!map.has(cleanGuid)) {
                                map.set(cleanGuid, []);
                            }
                            const list = map.get(cleanGuid)!;
                            if (!list.includes(groupName)) {
                                list.push(groupName);
                            }
                        }
                    }
                } catch (ex) {
                    console.warn(`⚠️ Erreur chargement groupe ${groupGuid}`, ex);
                }
            }
        } catch (ex) {
            console.error(`❌ Échec du pré-chargement des CardholderGroups`, ex);
        }

        return map;
    }

    private findAllItems(obj: any, items: any[] = []): any[] {
        if (!obj || typeof obj !== 'object') return items;
        for (const key of Object.keys(obj)) {
            if (key === 'item') {
                const val = obj[key];
                if (Array.isArray(val)) {
                    items.push(...val);
                } else {
                    items.push(val);
                }
            } else {
                this.findAllItems(obj[key], items);
            }
        }
        return items;
    }

    public async getCardholderGroups(cardholderGuid: string): Promise<string[]> {
        try {
            const map = await this.getOrBuildCardholderToGroupsMap();
            const cleanGuid = cardholderGuid.replace(/-/g, "").toLowerCase();
            return map.get(cleanGuid) || [];
        } catch (error) {
            console.warn(`⚠️ Échec de récupération des groupes pour ${cardholderGuid}`, error);
            return [];
        }
    }

    public determineNeedAppointment(groups: string[], transporterGroupName = "Transporteurs"): string {
        if (!groups || groups.length === 0) return "no";

        const isTransporter = groups.some(g => g.toLowerCase() === transporterGroupName.toLowerCase());
        const isOther = groups.some(g => g.toLowerCase() !== transporterGroupName.toLowerCase());

        if (isTransporter && !isOther) return "yes";
        if (isTransporter && isOther) return "have_to_choose";
        return "no";
    }

    public async getCredentialByCardId(cardId: string): Promise<TwicCardPayload> {
        try {
            const listXml = await this.getXml('/report/CredentialConfiguration?q=PageSize=500');
            const listObj = this.parser.parse(listXml);
            const rowsArray = this.findAllRows(listObj);

            const guids: string[] = [];
            for (const row of rowsArray) {
                const cells = row.Cell || [];
                const cellsArray = Array.isArray(cells) ? cells : [cells];
                const guidCell = cellsArray.find((c: any) => c.name === "Guid" || c.Name === "Guid");
                const guidValue = guidCell?.text || guidCell?.['#text'] || guidCell?.Value;
                if (guidValue) {
                    guids.push(guidValue);
                }
            }

            console.log(`📊 [Genetec] ${guids.length} credentials récupérés. Recherche du badge ID : "${cardId}"...`);

            for (const guid of guids) {
                try {
                    const detailXml = await this.getXml(`/entity?q=entity=${guid},Format,State,CardholderGuid`);
                    const detailObj = this.parser.parse(detailXml);
                    const rsp = detailObj?.rsp;

                    if (!rsp || String(rsp.status).toLowerCase() !== "ok") continue;

                    let foundCardId = "";

                    // REPRODUCTION EXACTE DE LA LOGIQUE C# (.Descendants) :
                    const kvPairs = [
                        ...this.findAllElements(detailObj, "KeyValuePairOfSystem.StringSystem.String"),
                        ...this.findAllElements(detailObj, "KeyValuePairOfSystemStringSystemString")
                    ];

                    const uidKv = kvPairs.find((kv: any) => String(kv?.Key).toLowerCase() === "uid");
                    if (uidKv && uidKv.Value) {
                        foundCardId = String(uidKv.Value);
                    }

                    if (!foundCardId) {
                        const cardIdElements = this.findAllElements(detailObj, "CardId");
                        if (cardIdElements.length > 0 && cardIdElements[0]) {
                            foundCardId = String(cardIdElements[0]);
                        }
                    }

                    if (!foundCardId && kvPairs.length > 0) {
                        if (kvPairs[0]?.Value) {
                            foundCardId = String(kvPairs[0].Value);
                        }
                    }

                    if (foundCardId && foundCardId.toLowerCase() === cardId.toLowerCase()) {
                        console.log(`✅ Badge ${cardId} trouvé dans Genetec !`);
                        
                        const cardholderGuid = rsp.CardholderGuid || "";
                        let cardholderName = "Inconnu";
                        let truckingCompany = "";
                        let cardholderGroups: string[] = [];
                        let expirationDate = undefined;

                        const meta = await this.getCredentialMetaData(guid);
                        expirationDate = meta.expirationDate;

                        const isCardholderAssigned = cardholderGuid && cardholderGuid !== "0" && cardholderGuid !== "00000000-0000-0000-0000-000000000000";

                        if (isCardholderAssigned) {
                            const details = await this.getCardholderDetails(cardholderGuid);
                            cardholderName = details.name;
                            truckingCompany = details.company;
                            cardholderGroups = await this.getCardholderGroups(cardholderGuid);
                        }

                        const needAppointment = this.determineNeedAppointment(cardholderGroups);
                        let access = "granted";
                        let deniedReason = null;
                        const state = rsp.State || "Active";
                        
                        let isExpired = false;
                        if (expirationDate) {
                            const expStr = String(expirationDate).trim();
                            if (expStr !== "" && !expStr.startsWith("0001") && !expStr.startsWith("9999")) {
                                const expDate = new Date(expStr);
                                if (!isNaN(expDate.getTime()) && expDate < new Date()) {
                                    isExpired = true;
                                }
                            }
                        }

                        if (!isCardholderAssigned) {
                            access = "denied";
                            deniedReason = "Aucun porteur associé au badge";
                        } else if (state.toLowerCase() !== "active") {
                            access = "denied";
                            deniedReason = `Badge inactif (${state})`;
                        } else if (isExpired) {
                            access = "denied";
                            deniedReason = "Badge expiré";
                        }

                        return {
                            card_id: foundCardId,
                            gate_id: this.gateId,
                            reader_id: null,
                            confidence: 1.0,
                            read_time: new Date().toISOString(),
                            access: access,
                            denied_reason: deniedReason,
                            need_appointment: needAppointment,
                            cardholder_name: cardholderName,
                            valid_until: expirationDate || null,
                            groups: cardholderGroups,
                            company: truckingCompany,
                            guid: guid,
                            cardholder_guid: cardholderGuid,
                            state: state
                        };
                    }
                } catch (innerEx) {
                    // Ignore une erreur isolée sur une credential
                }
            }
        } catch (error) {
            console.error(`❌ Erreur lors de la recherche du badge ${cardId} dans Genetec :`, error);
        }

        return {
            card_id: cardId,
            gate_id: this.gateId,
            reader_id: null,
            confidence: 1.0,
            read_time: new Date().toISOString(),
            access: "denied",
            denied_reason: "Unknow badge",
            need_appointment: "no",
            cardholder_name: "Inconnu",
            valid_until: null,
            groups: [],
            company: ""
        };
    }

    public async unlockDoor(doorGuid: string): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/action?q=UnlockDoor(${doorGuid})`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Length': '0'
                }
            });
            return response.ok;
        } catch (error) {
            console.error(`❌ Échec UnlockDoor pour ${doorGuid}:`, error);
            return false;
        }
    }
}