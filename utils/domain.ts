import isUrl from 'is-url';
import { joinURL } from 'ufo';
import Keyv from 'keyv';
import KeyvSqlite from '@keyv/sqlite';

const appDomainListCache = new Keyv<string[]>({
    store: new KeyvSqlite({
        // 这里只能相对路径才能工作
        uri: 'sqlite://./cache.db',
        table: 'app_domain_list_cache',
        busyTimeout: 10_000,
    }),
    // 默认缓存一个小时
    ttl: 1000 * 60 * 60,
});

export async function getAppDomainList(url: string): Promise<string[]> {
    try {
        if (!url) {
            return [];
        }
        if (!isUrl(url)) {
            return [url];
        }
        if (await appDomainListCache.has(url)) {
            return (await appDomainListCache.get(url)) as string[];
        }

        const response = await fetch(joinURL(url, '__blocklet__.js?type=json'));
        const domainAliases = (await response.json())?.domainAliases;
        if (Array.isArray(domainAliases) && domainAliases.length) {
            await appDomainListCache.set(url, domainAliases);
            return domainAliases;
        }

        return [url];
    } catch (error) {
        console.error(error);
        return [url];
    }
}
