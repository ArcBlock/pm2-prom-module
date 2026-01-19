import { encode } from '@abtnode/util/lib/base32';
import { joinURL } from 'ufo';
import axios from 'axios';
import Keyv from 'keyv';

const serverAdminUrlCache = new Keyv<string>({
    ttl: 1000 * 60 * 60 * 24, // 1 day
});

const storeVersionCache = new Keyv<string>({
    ttl: 1000 * 60 * 5, // 5 minutes
});

export function getServerUrl(serverDid: string): string {
    return `https://${encode(serverDid)}.did.abtnet.io`;
}

export async function getServerAdminUrl(serverDid: string): Promise<string> {
    const cacheKey = serverDid;
    const cached = await serverAdminUrlCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const serverUrl = getServerUrl(serverDid);
    try {
        const response = await fetch(`${serverUrl}/.well-known/did.json`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        const serverService = data.services?.find((service: any) => service.type === 'server');
        const adminUrl = joinURL(serverUrl, serverService?.path || '/admin/');
        await serverAdminUrlCache.set(cacheKey, adminUrl);
        return adminUrl;
    } catch (error) {
        console.error(error);
        const fallbackUrl = joinURL(serverUrl, '/.well-known/server/admin');
        await serverAdminUrlCache.set(cacheKey, fallbackUrl);
        return fallbackUrl;
    }
}

export type StoreUrl =
    | 'https://test.store.blocklet.dev'
    | 'https://dev.store.blocklet.dev'
    | 'https://store.blocklet.dev';
export async function getStoreVersion(
    storeUrl: StoreUrl,
    did: string,
    defaultValue: string = '-',
    timeout: number = 20_000
): Promise<string> {
    const cacheKey = `${storeUrl}:${did}`;
    const cached = await storeVersionCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const response = await axios.get(`${storeUrl}/api/blocklets/${did}/blocklet.json`, {
            timeout,
        });
        const version = response.data.version || defaultValue;
        await storeVersionCache.set(cacheKey, version);
        return version;
    } catch (error) {
        await storeVersionCache.set(cacheKey, defaultValue);
        return defaultValue;
    }
}
