import { access, constants, readFile } from 'node:fs/promises';
import os from 'node:os';
import { getCpuCount } from './cpu';
import Docker from 'dockerode';
import getIP from '@abtnode/util/lib/get-ip';
import { v4 as internalIpV4 } from 'internal-ip';
import uniq from 'lodash/uniq';

// 初始化 Docker 客户端
const docker = new Docker();

//const MEMORY_AVAILABLE = '/sys/fs/cgroup/memory.limit_in_bytes';
//const MEMORY_USED = '/sys/fs/cgroup/memory.usage_in_bytes';

const MEMORY_AVAILABLE = '/sys/fs/cgroup/memory.max';
const MEMORY_USED = '/sys/fs/cgroup/memory.current';
const CPUS_LIMIT = '/sys/fs/cgroup/cpu.max';

export const hasDockerLimitFiles = async () => {
    await access(MEMORY_AVAILABLE, constants.R_OK);
};

export const getAvailableMemory = async () => {
    try {
        const data = (await readFile(MEMORY_AVAILABLE, { encoding: 'utf8' })).trim();

        if (data === 'max') {
            return os.totalmem();
        } else {
            const memoryNumber = parseInt(data, 10);

            if (isNaN(memoryNumber)) {
                return 0;
            } else {
                return memoryNumber;
            }
        }
    } catch {
        return 0;
    }
};

export const getBlockletServerInfo = async (): Promise<{
    type: string;
    name: string;
    version: string;
    mode: string;
    internalIP: string;
}> => {
    try {
        const internalIP =
            (await internalIpV4()) ||
            (await getIP({ includeExternal: false, timeout: 5000 })).internal;
        if (!internalIP) {
            throw new Error('Failed to get internal IP address');
        }
        const url = `https://${internalIP.replace(/\./g, '-')}.ip.abtnet.io/.well-known/did.json`;
        const response = await fetch(url);
        if (response.status !== 200) {
            throw new Error(
                `Failed to get blocklet server info, url: ${url}, status: ${response.status}, statusText: ${response.statusText}`
            );
        }
        const data = await response.json();
        const metadata = data.services.find((service: any) => service.type === 'server').metadata;
        return {
            type: 'server',
            name: metadata.name,
            version: metadata.version,
            mode: metadata.mode,
            internalIP,
        };
    } catch (error) {
        console.error(error);
        return {
            type: 'server',
            name: 'unknown',
            version: 'unknown',
            mode: 'unknown',
            internalIP: 'unknown',
        };
    }
};

export const getUsedMemory = async () => {
    try {
        const data = (await readFile(MEMORY_USED, { encoding: 'utf8' })).trim();
        const usedMemory = parseInt(data, 10);

        if (isNaN(usedMemory)) {
            return 0;
        } else {
            return usedMemory;
        }
    } catch {
        return 0;
    }
};

export const getFreeMemory = async () => {
    try {
        const data = (await readFile(MEMORY_AVAILABLE, { encoding: 'utf8' })).trim();
        const systemFreeMem = os.freemem();

        if (data === 'max') {
            // In that case we do not have any limits. Use only freemem
            return systemFreeMem;
        }

        // In that case we should calculate free memory
        const availableMemory = parseInt(data, 10);

        if (isNaN(availableMemory)) {
            // If we can not parse return OS Free memory
            return systemFreeMem;
        }

        const usedMemory = await getUsedMemory();

        if (availableMemory <= systemFreeMem) {
            // We have docker limit in the container
            return availableMemory - usedMemory;
        } else {
            // Limited by system available memory
            return systemFreeMem;
        }
    } catch {
        return 0;
    }
};

export const getCPULimit = async () => {
    let count = getCpuCount();
    const delimeter = 100000;

    try {
        const data = (await readFile(CPUS_LIMIT, { encoding: 'utf8' })).trim();

        if (data) {
            const values = data.split(' ');

            if (values.length === 2) {
                const parsedValue = parseInt(values[0], 10);

                if (!isNaN(parsedValue)) {
                    count = parsedValue / delimeter;
                }
            }
        }
    } catch {}

    return count;
};

type DockerStats = {
    name: string;
    cpuUsage: number;
    memoryUsage: number;
    totalMemory: number;
};

/**
 * 获取单个容器的统计信息
 */
async function getContainerStats(containerId: string): Promise<DockerStats | null> {
    try {
        const container = docker.getContainer(containerId);
        const stats = await container.stats({ stream: false });
        
        // 内存使用信息
        const memoryUsage = stats.memory_stats?.usage || 0;
        const memoryLimit = stats.memory_stats?.limit || 0;
        
        // CPU使用信息
        const cpuStats = stats.cpu_stats?.cpu_usage;
        const preCpuStats = stats.precpu_stats?.cpu_usage;
        
        let cpuPercent = 0;
        if (cpuStats && preCpuStats && stats.cpu_stats?.system_cpu_usage && stats.precpu_stats?.system_cpu_usage) {
            const cpuDelta = cpuStats.total_usage - preCpuStats.total_usage;
            const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
            const onlineCpus = stats.cpu_stats?.online_cpus || 1;
            
            if (systemDelta > 0) {
                cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100;
            }
        }
        
        return {
            name: containerId,
            cpuUsage: Math.round(cpuPercent * 10) / 10, // 保留1位小数
            memoryUsage: memoryUsage,
            totalMemory: memoryLimit,
        };
    } catch (error) {
        console.error(`Failed to get stats for container ${containerId}:`, error.message);
        return null;
    }
}

export async function getDockerStats(ids: string[]): Promise<DockerStats[]> {
    try {
        if (!ids.length) {
            return [];
        }
        
        // 并行获取所有容器的统计信息
        const results = await Promise.all(uniq(ids).map(id => getContainerStats(id)));
        
        // 过滤出成功的结果
        return results.filter((stat): stat is DockerStats => stat !== null);
    } catch (error) {
        console.error('Error getting Docker stats:', error);
        return [];
    }
}
