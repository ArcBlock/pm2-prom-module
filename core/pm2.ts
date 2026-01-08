import pm2, { Pm2Env } from 'pm2';

import { App, IPidDataInput, PM2_METRICS } from './app';
import { toUndescore } from '../utils';
import { getPidsUsage } from '../utils/cpu';
import keyBy from 'lodash/keyBy';

import {
    initDynamicGaugeMetricClients,
    dynamicGaugeMetricClients,
    metricAvailableApps,
    metricAppInstances,
    metricAppAverageMemory,
    metricAppTotalMemory,
    metricAppAverageCpu,
    metricAppPidsCpuLast,
    metricAppRestartCount,
    metricAppUptime,
    metricAppPidsMemory,
    metricAppPidsCpuThreshold,
    metricAppStatus,
    deletePromAppMetrics,
    deletePromAppInstancesMetrics,
    metricAppDomainList,
    metricAppComponentList,
} from '../metrics';

import { deleteAppMetrics } from '../metrics/app';

import { getLogger } from '../utils/logger';
import { getDockerStats } from '../utils/docker';
import { getAppDomainList } from '../utils/domain';
import pAll from 'p-all';
import { getServerAdminUrl, getStoreVersion } from '../utils/server';

type IPidsData = Record<number, IPidDataInput>;
type IAppData = Record<string, { pids: number[]; restartsSum: number; status?: Pm2Env['status'] }>;

const WORKER_CHECK_INTERVAL = 1000;
const SHOW_STAT_INTERVAL = 10000;

const APPS: { [key: string]: App } = {};

const isMonitoringApp = (app: pm2.ProcessDescription) => {
    const pm2_env = app.pm2_env as pm2.Pm2Env;

    if (
        pm2_env.axm_options.isModule ||
        !app.name ||
        app.pm_id === undefined // pm_id might be zero
    ) {
        return false;
    }

    return true;
};

const updateAppPidsData = (workingApp: App, pidData: IPidDataInput) => {
    workingApp.updatePid({
        id: pidData.id,
        memory: pidData.memory,
        cpu: pidData.cpu || 0,
        pmId: pidData.pmId,
        restartCount: pidData.restartCount,
        createdAt: pidData.createdAt,
        metrics: pidData.metrics,
        status: pidData.status,
        appUrl: pidData.appUrl,
        appName: pidData.appName,
        appPid: pidData.appPid,
    });
};

const detectActiveApps = () => {
    const logger = getLogger();

    pm2.list((err, apps) => {
        if (err) return console.error(err.stack || err);

        const pidsMonit: IPidsData = {};
        const mapAppPids: IAppData = {};
        const activePM2Ids = new Set<number>();

        apps.forEach((appInstance: pm2.ProcessDescription) => {
            const pm2_env = appInstance.pm2_env as pm2.Pm2Env;
            const appName = appInstance.name;

            if (!isMonitoringApp(appInstance) || !appName || appInstance.pm_id === undefined) {
                return;
            }

            // Fill all apps pids
            if (!mapAppPids[appName]) {
                mapAppPids[appName] = {
                    pids: [],
                    restartsSum: 0,
                };
            }

            mapAppPids[appName].restartsSum =
                mapAppPids[appName].restartsSum + Number(pm2_env.restart_time || 0);

            // Get the last app instance status
            mapAppPids[appName].status = appInstance.pm2_env?.status;

            if (appInstance.pid && appInstance.pm_id !== undefined) {
                mapAppPids[appName].pids.push(appInstance.pid);

                // Fill active pm2 apps id to collect internal statistic
                if (pm2_env.status === 'online') {
                    activePM2Ids.add(appInstance.pm_id);
                }

                // Fill monitoring data
                pidsMonit[appInstance.pid] = {
                    cpu: 0,
                    memory: 0,
                    pmId: appInstance.pm_id,
                    id: appInstance.pid,
                    restartCount: pm2_env.restart_time || 0,
                    createdAt: pm2_env.created_at || 0,
                    metrics: pm2_env.axm_monitor,
                    status: pm2_env.status,
                    appUrl: pm2_env.BLOCKLET_APP_URL!,
                    appName: pm2_env.BLOCKLET_APP_NAME!,
                    appPid: pm2_env.BLOCKLET_APP_PID!,
                };
            }
        });

        Object.keys(APPS).forEach((appName) => {
            const processingApp = mapAppPids[appName];

            // Filters apps which do not have active pids
            if (!processingApp) {
                logger.debug(`Delete ${appName} because it not longer exists`);

                const workingApp = APPS[appName];
                const instances = workingApp.getActivePm2Ids();

                // Clear app metrics
                deleteAppMetrics(appName);

                // Clear all metrics in prom-client because an app is not exists anymore
                deletePromAppMetrics(appName, instances);

                delete APPS[appName];
            } else {
                const workingApp = APPS[appName];

                if (workingApp) {
                    const activePids = processingApp.pids;
                    const removedPids = workingApp.removeNotActivePids(activePids);

                    if (removedPids.length) {
                        const removedIntances = removedPids.map((entry) => entry.pmId);
                        logger.debug(
                            `App ${appName} clear metrics. Removed PIDs ${removedIntances.toString()}`
                        );
                        deletePromAppInstancesMetrics(appName, removedIntances);

                        if (!activePids.length) {
                            // Delete app metrics because it does not have active PIDs anymore
                            logger.debug(
                                `App ${appName} does not have active PIDs. Clear app metrics`
                            );
                            deleteAppMetrics(appName);
                        }
                    }

                    const pidsRestartsSum = workingApp
                        .getRestartCount()
                        .reduce((accum, item) => accum + item.value, 0);

                    if (processingApp.restartsSum > pidsRestartsSum) {
                        // Reset metrics when active restart app bigger then active app
                        // This logic exist to prevent autoscaling problems if we use only !==
                        logger.debug(`App ${appName} has been restarted. Clear app metrics`);
                        deleteAppMetrics(appName);
                    }
                }
            }
        });

        // Create instances for new apps
        for (const [appName, entry] of Object.entries(mapAppPids)) {
            if (!APPS[appName]) {
                APPS[appName] = new App(appName);
            }

            const workingApp = APPS[appName];

            if (workingApp) {
                // Update status
                workingApp.updateStatus(entry.status);
            }
        }

        // Update metric with available apps
        metricAvailableApps?.set(Object.keys(APPS).length);

        // Get all pids to monit
        const pids = Object.keys(pidsMonit);

        // Get real pids data.
        // !ATTENTION! Can not use PM2 app.monit because of incorrect values of CPU usage
        getPidsUsage(pids)
            .then(async (stats) => {
                // Fill data for all pids
                if (stats && Object.keys(stats).length) {
                    for (const [pid, stat] of Object.entries(stats)) {
                        const pidId = Number(pid);

                        if (!stat) {
                            continue;
                        }

                        if (pidId && pidsMonit[pidId]) {
                            pidsMonit[pidId].cpu = Math.round(stat.cpu * 10) / 10;
                            pidsMonit[pidId].memory = stat.memory;
                        }
                    }
                }

                // Get docker stats
                // @ts-expect-error
                const dockerApps = apps.filter((app) => app.pm2_env?.BLOCKLET_DOCKER_NAME);
                await getDockerStats(
                    // @ts-expect-error
                    dockerApps.map((x) => x.pm2_env?.BLOCKLET_DOCKER_NAME)
                ).then((stats) => {
                    stats.map((stat, i) => {
                        if (!stat) {
                            return;
                        }
                        const entry = mapAppPids[dockerApps[i].name!];
                        if (entry) {
                            entry.pids.forEach((pid) => {
                                pidsMonit[pid].cpu = stat.cpuUsage;
                                pidsMonit[pid].memory = stat.memoryUsage;
                            });
                        }
                    });
                });

                for (const [appName, entry] of Object.entries(mapAppPids)) {
                    const workingApp = APPS[appName];

                    if (workingApp) {
                        // Update pids data
                        entry.pids.forEach((pidId) => {
                            const monit: IPidDataInput | undefined = pidsMonit[pidId];

                            if (monit) {
                                updateAppPidsData(workingApp, monit);
                            }
                        });

                        // Collect metrics
                        processWorkingApp(workingApp);
                    }
                }
            })
            .catch((err) => {
                console.error(err.stack || err);
            });

        const uniqAppMaps: Record<string, any> = keyBy(
            // @ts-expect-error
            apps.filter((x) => x.pm2_env?.BLOCKLET_APP_PID!),
            (x) => x.pm2_env?.BLOCKLET_APP_PID!
        );
        pAll(
            Object.values(uniqAppMaps)
                .map((x) => x.pid)
                .map((pid) => {
                    const app = pidsMonit[pid] as IPidDataInput;

                    if (!app) {
                        throw new Error(`App ${pid} does not have active PIDs. Clear app metrics`);
                    }

                    return app;
                })
                .map((app) => {
                    return async () => {
                        return {
                            appName: app.appName,
                            appPid: app.appPid,
                            urls: await getAppDomainList(app.appUrl),
                        };
                    };
                }),
            { concurrency: 8 }
        )
            .then((apps: Array<{ appName: string; urls: Array<string>; appPid: string }>) => {
                for (const app of apps) {
                    if (!app.urls || !Array.isArray(app.urls)) {
                        continue;
                    }
                    for (const url of app.urls) {
                        metricAppDomainList?.set(
                            { appName: app.appName, domain: url, appPid: app.appPid },
                            app.urls.length
                        );
                    }
                }
            })
            .catch((error) => console.error(error));

        // Collect component list for each app
        metricAppComponentList?.reset();
        pAll(
            apps.map((appInstance: pm2.ProcessDescription) => {
                return async () => {
                    const pm2_env = appInstance.pm2_env as pm2.Pm2Env;
                    const appPid = pm2_env.BLOCKLET_APP_PID;

                    if (!appPid) {
                        return;
                    }

                    const appName = pm2_env.BLOCKLET_APP_NAME;
                    const domain = pm2_env.BLOCKLET_APP_URL;
                    const serverUrl = await getServerAdminUrl(pm2_env.ABT_NODE_DID || '');

                    const componentName = (pm2_env.BLOCKLET_REAL_NAME || '').split('/').pop();
                    const componentDid = pm2_env.BLOCKLET_COMPONENT_DID || '';
                    const componentVersion = pm2_env.BLOCKLET_COMPONENT_VERSION || '';
                    const [
                        componentVersionFromTestStore,
                        componentVersionFromDevStore,
                        componentVersionFromProdStore,
                    ] = await Promise.all([
                        getStoreVersion('https://test.store.blocklet.dev', componentDid),
                        getStoreVersion('https://dev.store.blocklet.dev', componentDid),
                        getStoreVersion('https://store.blocklet.dev', componentDid),
                    ]);

                    const labels = {
                        id: `${appName}/${componentName}`,
                        appName,
                        domain,
                        appPid,
                        componentName,
                        componentDid,
                        componentVersion,
                        componentVersionFromTestStore,
                        componentVersionFromDevStore,
                        componentVersionFromProdStore,
                        serverUrl,
                    };
                    metricAppComponentList?.set(labels, 1);
                };
            }),
            { concurrency: 16 }
        ).catch((error) => console.error(error));
    });
};

export const startPm2Connect = (conf: IConfig) => {
    pm2.connect((err) => {
        if (err) return console.error(err.stack || err);

        const additionalMetrics = PM2_METRICS.map((entry) => {
            return {
                key: toUndescore(entry.name),
                description: `${entry.name}. Unit "${entry.unit}"`,
            };
        });

        if (additionalMetrics.length) {
            initDynamicGaugeMetricClients(additionalMetrics);
        }

        detectActiveApps();

        // Start timer to update available apps
        setInterval(() => {
            detectActiveApps();
        }, conf.app_check_interval ?? WORKER_CHECK_INTERVAL);

        if (conf.debug) {
            setInterval(() => {
                if (Object.keys(APPS).length) {
                    for (const [, app] of Object.entries(APPS)) {
                        const cpuValues = app.getCpuThreshold().map((entry) => entry.value);
                        const memory = Math.round(app.getTotalUsedMemory() / 1024 / 1024);
                        const CPU = cpuValues.length ? cpuValues.toString() : '0';

                        getLogger().debug(
                            `App "${app.getName()}" has ${app.getActiveWorkersCount()} worker(s). CPU: ${CPU}, Memory: ${memory}MB`
                        );
                    }
                } else {
                    getLogger().debug(`No apps available`);
                }
            }, SHOW_STAT_INTERVAL);
        }
    });
};

function processWorkingApp(workingApp: App) {
    const labels = { app: workingApp.getName() };

    metricAppInstances?.set(labels, workingApp.getActiveWorkersCount());
    metricAppAverageMemory?.set(labels, workingApp.getAverageUsedMemory());
    metricAppTotalMemory?.set(labels, workingApp.getTotalUsedMemory());
    metricAppAverageCpu?.set(labels, workingApp.getAverageCpu());
    metricAppUptime?.set(labels, workingApp.getUptime());
    metricAppStatus?.set(labels, workingApp.getStatus());

    workingApp.getCurrentPidsCpu().forEach((entry) => {
        metricAppPidsCpuLast?.set({ ...labels, instance: entry.pmId }, entry.value);
    });

    workingApp.getCpuThreshold().forEach((entry) => {
        metricAppPidsCpuThreshold?.set({ ...labels, instance: entry.pmId }, entry.value);
    });

    workingApp.getCurrentPidsMemory().forEach((entry) => {
        metricAppPidsMemory?.set({ ...labels, instance: entry.pmId }, entry.value);
    });

    workingApp.getRestartCount().forEach((entry) => {
        metricAppRestartCount?.set({ ...labels, instance: entry.pmId }, entry.value);
    });

    workingApp.getPidPm2Metrics().forEach((entry) => {
        Object.keys(entry.metrics).forEach((metricKey) => {
            if (dynamicGaugeMetricClients[metricKey]) {
                dynamicGaugeMetricClients[metricKey].set(
                    { ...labels, instance: entry.pmId },
                    entry.metrics[metricKey]
                );
            }
        });
    });
}
