import axios from 'axios';
import isUrl from 'is-url';
import isEmpty from 'lodash/isEmpty';
import { joinURL } from 'ufo';
import Keyv from 'keyv';

const appUrlsCache = new Keyv<string[]>(); 

export async function getAppUrls(url: string): Promise<string[]> {

    try {
        if (!url) {
            return [];
        }
        if (!isUrl(url)) {
            return [url];
        }
        if (await appUrlsCache.has(url)) {
            return await appUrlsCache.get(url) as string[];
        }

        const response = await axios.get(joinURL(url, '__blocklet__.js?type=json'));
        console.error('debug233.response.data', response.data);
        const domainAliases = response.data?.domainAliases || [];
        if (!isEmpty(domainAliases)) {
            await appUrlsCache.set(url, domainAliases);
        }

        return domainAliases || [url];
    } catch (error) {
        console.error(error);
        return [url];
    }
}