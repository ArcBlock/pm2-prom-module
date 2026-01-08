import { encode } from '@abtnode/util/lib/base32';
import { joinURL } from 'ufo';
import axios from 'axios';

export function getServerUrl(serverDid: string): string {
    return `https://${encode(serverDid)}.did.abtnet.io`;
}

export async function getServerAdminUrl(serverDid: string): Promise<string> {
    const serverUrl = getServerUrl(serverDid);
    try {
        const response = await fetch(`${serverUrl}/.well-known/did.json`);
        const data = await response.json();
        const serverService = data.services?.find((service: any) => service.type === 'server');
        return joinURL(serverUrl, serverService?.path || '/admin/');
    } catch (error) {
        console.error(error);
        return joinURL(serverUrl, '/.well-known/server/admin');
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
    timeout: number = 5000
): Promise<string> {
    try {
        const response = await axios.get(`${storeUrl}/api/blocklets/${did}/blocklet.json`, {
            timeout,
        });
        return response.data.version || defaultValue;
    } catch (error) {
        console.error(error);
        return defaultValue;
    }
}
