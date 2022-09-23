/**
 * -------------------------------------------------------------------
 *  ioBroker Oura Adapter
 * @github  https://github.com/Acgua/ioBroker.oura
 * @author  Acgua <https://github.com/Acgua/ioBroker.oura>
 * @created Adapter Creator v2.1.1
 * @license Apache License 2.0
 * -------------------------------------------------------------------
 */

/**
 * For all imported NPM modules, open console, change dir e.g. to "C:\iobroker\node_modules\ioBroker.oura\",
 * and execute "npm install <module name>", ex: npm install axios
 */
import * as utils from '@iobroker/adapter-core';
import axios from 'axios';
import { err2Str, getIsoDate, wait } from './lib/methods';

/**
 * Main Adapter Class
 */
export class Oura extends utils.Adapter {
    // Imported methods from ./lib/methods
    public err2Str = err2Str.bind(this);
    public wait = wait.bind(this);
    public getIsoDate = getIsoDate.bind(this);
    public readonly ouraGroups = ['daily_activity', 'daily_readiness', 'daily_sleep', 'heartrate', 'session', 'sleep', 'tag', 'workout'];
    private intervalCloudupdate: any;
    private timerMidnight: any;
    //                ex: 2022-09-20    daily_activity    score       90
    private cloudData: { [k: string]: { [n: string]: { [m: string]: any } } };

    /**
     * Constructor
     */
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'oura' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        // this.on('stateChange', this.onStateChange.bind(this));
        this.intervalCloudupdate = null;
        this.timerMidnight = null;
        this.cloudData = {};
    }

    /**
     * Called once ioBroker databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        try {
            /**
             * User settings verification
             */
            // Basic verification of token
            let tkn = this.config.token;
            tkn = tkn.replace(/[^0-9A-Z]/g, ''); // remove all forbidden chars
            if (tkn.length !== 32) throw `Your Oura cloud token in your adapter configuration is not valid! [${this.config.token}]`;
            this.config.token = tkn;

            // Verification of Oura Cloud update interval
            if (!this.config.updateInterval || this.config.updateInterval < 15) {
                this.log.warn(`The Cloud update interval '${String(this.config.updateInterval)}' in your adapter configuration is not allowed, so default of 60 minutes is used.`);
                this.config.updateInterval = 60;
            }

            // Verification of number of days to be fetched and kept
            if (!this.config.numberDays || this.config.numberDays < 1 || this.config.numberDays > 30) {
                this.log.warn(`'${String(this.config.numberDays)}' days in your adapter configuration is not allowed, so default of 10 days is used.`);
                this.config.numberDays = 10;
            }

            // Verification of axios get request timeout
            if (!this.config.cloudTimeout || this.config.cloudTimeout < 0 || this.config.cloudTimeout > 100000) {
                this.log.warn(`The Cloud timeout '${String(this.config.cloudTimeout)}' in your adapter configuration is not valid, so default of 5000 ms is used.`);
                this.config.cloudTimeout = 5000;
            }

            // Create info objects
            await this.setObjectNotExistsAsync('info', { type: 'channel', common: { name: 'Information' }, native: {} });
            await this.setObjectNotExistsAsync('info.lastCloudUpdate', { type: 'state', common: { name: 'Last Cloud update', type: 'number', role: 'date', read: true, write: false, def: 0 }, native: {} });

            // Update now
            if (await this.asyncGetAllCloudData()) {
                await this.asyncUpdateCloudObjects();
                await this.asyncCleanupObjects();
            }

            // Update periodically
            this.intervalCloudupdate = setInterval(async () => {
                this.log.info(`Scheduled update of cloud information per interval of ${this.config.updateInterval} minutes.`);
                if (await this.asyncGetAllCloudData()) {
                    await this.asyncUpdateCloudObjects();
                    await this.asyncCleanupObjects();
                }
            }, 1000 * 60 * this.config.updateInterval); // typically every hour (this.config.updateInterval default is 60 minutes)

            // Update at midnight
            this.executeAtMidnight();
        } catch (e) {
            this.log.error(this.err2Str(e));
        }
    }

    /**
     * Execute every midnight
     * We use setTimeout to avoid external modules
     */
    private executeAtMidnight(): void {
        clearTimeout(this.timerMidnight);
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0); // update hours, mins, secs to the 24th hour (which is when the next day starts)
        const msToMidnight = midnight.getTime() - Date.now();
        this.timerMidnight = setTimeout(async () => {
            // we do not get info from Oura cloud at midnight to avoid many requests the same time by different users
            await this.asyncUpdateCloudObjects();
            await this.asyncCleanupObjects();
            // schedule next timer
            this.executeAtMidnight();
        }, msToMidnight + 1000);
    }

    /**
     * asyncGetAllCloudData into this.cloudData
     */
    private async asyncGetAllCloudData(): Promise<false | true> {
        try {
            const startDate = new Date(Date.now() - this.config.numberDays * 86400000); // 86400000 = 24 hours in ms
            const endDate = new Date(Date.now() + 86400000); // for yet some unknown reason, some data require a "+1d"...
            const gotData = [];
            const noData = [];
            for (const groupId of this.ouraGroups) {
                const cloudAllDays = await this.asyncRequestCloudData(groupId, startDate, endDate);
                if (!cloudAllDays) {
                    noData.push(groupId);
                    continue;
                }
                gotData.push(groupId);
                for (const cloudDay of cloudAllDays) {
                    let isoDay: string;
                    if (cloudDay.day && typeof cloudDay.day === 'string') {
                        isoDay = cloudDay.day;
                    } else {
                        this.log.warn(`'${groupId}' Cloud data retrieval: No date in object, so we disregard`);
                        continue;
                    }
                    if (!this.cloudData[groupId]) this.cloudData[groupId] = {};
                    if (!this.cloudData[groupId][isoDay]) this.cloudData[groupId][isoDay] = {};
                    this.cloudData[groupId][isoDay] = cloudDay;
                }
            }
            if (noData.length > 0) this.log.debug(`No Oura cloud data available for: ${noData.join(', ')}`);
            if (gotData.length > 0) {
                if (gotData.length > 0) this.log.info(`Following data received from Oura cloud: ${gotData.join(', ')}`);
                return true;
            } else {
                return false;
            }
        } catch (e) {
            this.log.error(this.err2Str(e));
            return false;
        }
    }

    /**
     * Empty states if there is no data for the day
     */
    private async asyncCleanupObjects(): Promise<void> {
        try {
            for (const groupId of this.ouraGroups) {
                // get channels, their _id is e.g. 'oura.0.daily_activity.00-today', 'oura.0.daily_activity.04-days-ago'
                const objDays = await this.getChannelsAsync(groupId);
                for (const dayObj of objDays) {
                    // Get '00-today' from 'oura.0.daily_activity.00-today'
                    const dayStr = dayObj._id.split('.')[dayObj._id.split('.').length - 1];
                    const iso = this.getIsoDateForWord(dayStr); // 00-today -> ISO date like '2023-12-24'
                    if (!iso) throw `Invalid id: '${dayObj._id}' of group '${groupId}'`;
                    const stateObj = await this.getStatesAsync(`${groupId}.${dayStr}.*`);
                    if (stateObj[`${dayObj._id}.day`].val !== iso) {
                        const stateList = Object.keys(stateObj);
                        for (const id of stateList) {
                            await this.setStateChangedAsync(id, { val: null, ack: true });
                        }
                    }
                }
            }
        } catch (e) {
            this.log.error(this.err2Str(e));
            return;
        }
    }

    /**
     * Update states and create objects if not existing based on this.cloudData
     */
    private async asyncUpdateCloudObjects(): Promise<void> {
        try {
            await this.setStateAsync('info.lastCloudUpdate', { val: Date.now(), ack: true });
            const groupsList = Object.keys(this.cloudData);
            for (const groupId of groupsList) {
                await this.setObjectNotExistsAsync(groupId, { type: 'device', common: { name: groupId }, native: {} });
                const isoDaysList = Object.keys(this.cloudData[groupId]);
                for (const isoDay of isoDaysList) {
                    const lpCloudObj = this.cloudData[groupId][isoDay];
                    const dayStr = this.getWordForIsoDate(isoDay);
                    if (!dayStr) {
                        this.log.warn(`'${groupId}' Cloud data retrieval: ISO date seems to be not valid - ${isoDay}`);
                        continue;
                    }
                    await this.setObjectNotExistsAsync(`${groupId}.${dayStr}`, { type: 'channel', common: { name: dayStr + ' - ' + groupId }, native: {} });
                    await this.setObjectNotExistsAsync(`${groupId}.${dayStr}.json`, { type: 'state', common: { name: 'JSON', type: 'string', role: 'json', read: true, write: false }, native: {} });
                    await this.setStateChangedAsync(`${groupId}.${dayStr}.json`, { val: JSON.stringify(lpCloudObj), ack: true });
                    for (const prop in lpCloudObj) {
                        if (prop === 'timestamp') {
                            await this.setObjectNotExistsAsync(`${groupId}.${dayStr}.timestamp`, { type: 'state', common: { name: 'Timestamp', type: 'number', role: 'date', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${groupId}.${dayStr}.timestamp`, { val: new Date(lpCloudObj.timestamp).getTime(), ack: true });
                        } else if (prop === 'contributors') {
                            for (const k in lpCloudObj.contributors) {
                                await this.setObjectNotExistsAsync(`${groupId}.${dayStr}.contributors.${k}`, { type: 'state', common: { name: k, type: 'number', role: 'info', read: true, write: false }, native: {} });
                                await this.setStateChangedAsync(`${groupId}.${dayStr}.contributors.${k}`, { val: lpCloudObj.contributors[k], ack: true });
                            }
                        } else if (typeof lpCloudObj[prop] === 'number') {
                            await this.setObjectNotExistsAsync(`${groupId}.${dayStr}.${prop}`, { type: 'state', common: { name: prop, type: 'number', role: 'info', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${groupId}.${dayStr}.${prop}`, { val: lpCloudObj[prop], ack: true });
                        } else if (typeof lpCloudObj[prop] === 'string') {
                            await this.setObjectNotExistsAsync(`${groupId}.${dayStr}.${prop}`, { type: 'state', common: { name: prop, type: 'string', role: 'info', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${groupId}.${dayStr}.${prop}`, { val: lpCloudObj[prop], ack: true });
                        } else if (typeof lpCloudObj[prop] === 'boolean') {
                            await this.setObjectNotExistsAsync(`${groupId}.${dayStr}.${prop}`, { type: 'state', common: { name: prop, type: 'boolean', role: 'info', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${groupId}.${dayStr}.${prop}`, { val: lpCloudObj[prop], ack: true });
                        } else if (typeof lpCloudObj[prop] === 'object') {
                            // Nothing, we disregard objects, as these will be available in JSON anyway
                        } else {
                            this.log.error(`${groupId}: property '${prop}' is unknown! - value: [${lpCloudObj[prop]}], type: ${typeof lpCloudObj[prop]}`);
                        }
                    }
                }
            }
        } catch (e) {
            this.log.error(this.err2Str(e));
        }
    }

    /**
     * Get Oura Cloud Information
     * @param groupId - daily_activity, etc.
     * @param startDate as date object or timestamp
     * @param endDate as date object or timestamp
     * @returns Object
     */
    private async asyncRequestCloudData(groupId: string, startDate: Date | number, endDate: Date | number): Promise<[{ [k: string]: any }] | false> {
        try {
            // Verify dates and convert to ISO format
            const sDate = this.getIsoDate(startDate);
            const eDate = this.getIsoDate(endDate);
            if (!sDate || !eDate) throw `Could not get cloud data, wrong date(s) provided`;
            const url = `https://api.ouraring.com/v2/usercollection/${groupId}?start_date=${sDate}&end_date=${eDate}`;
            this.log.debug('Final URL: ' + url);

            /**
             * Axios
             * https://cloud.ouraring.com/v2/docs#section/Oura-HTTP-Response-Codes
             */
            try {
                const config = {
                    method: 'get',
                    headers: { Authorization: 'Bearer ' + this.config.token },
                    timeout: this.config.cloudTimeout,
                };
                const response = await axios.get(url, config);
                this.log.debug(`Response Status: ${response.status} - ${response.statusText}`);
                this.log.debug(`Response Config: ${JSON.stringify(response.config)}`);
                if (!response.data || !response.data.data || !response.data.data[0]) {
                    // this.log.info('::::: EMPTY RESPONSE ::::::');
                    return false;
                }
                return response.data.data;
            } catch (err) {
                if (axios.isAxiosError(err)) {
                    if (!err?.response) {
                        this.log.error(`[Oura Cloud] Login Failed - No Server Response. Timeout: ${this.config.cloudTimeout} ms`);
                    } else if (err.response?.status === 400) {
                        this.log.error('[Oura Cloud] Login Failed - Error 400 - ' + err.response?.statusText);
                    } else if (err.response?.status === 401) {
                        this.log.error(`[Oura Cloud] Error 401 - Invalid Access Token. Access token not provided or is invalid.`);
                        this.log.error(`[Oura Cloud] Login Failed. Please check if your token "${this.config.token}" is correct.`);
                    } else if (err.response?.status === 426) {
                        this.log.error(`[Oura Cloud] Error 426 - Minimum App Version Error. The Oura user's mobile app does not meet the minimum app version requirement to support sharing the requested data type. The Oura user must update their mobile app to enable API access for the requested data type.`);
                        this.log.error(`[Oura Cloud] Login Failed. Please ensure you use the latest Oura app`);
                    } else if (err.response?.status === 429) {
                        this.log.error(`[Oura Cloud] Error 429 - Request Rate Limit Exceeded. The API is rate limited to 5000 requests in a 5 minute period and you exceed this limit.`);
                        this.log.error(`[Oura Cloud] Login Failed.`);
                    } else if (err.response?.status) {
                        console.log(`[Oura Cloud] Login Failed: Error ${err.response.status} - ${err.response.statusText}`);
                    } else {
                        console.log('[Oura Cloud] Login Failed - Error');
                    }
                } else {
                    if (err instanceof Error) {
                        if (err.stack) {
                            if (err.stack.startsWith('TypeError')) {
                                this.log.error('[Oura Cloud] TYPE ERROR:' + err.stack);
                            } else {
                                this.log.error('[Oura Cloud] OTHER ERROR: ' + err.stack);
                            }
                        }
                        if (err.message) this.log.error('msg: ' + err.message);
                    } else {
                        this.log.error('[Oura Cloud] Error: ' + this.err2Str(err));
                    }
                }
                return false;
            }
        } catch (e) {
            this.log.error(this.err2Str(e));
            return false;
        }
    }

    /**
     * Get ISO date '2023-12-24' from '00-today', '01-yesterday', '02-days-ago' etc.
     */
    private getIsoDateForWord(word: string): string | false {
        try {
            const dayNo = parseInt(word.slice(0, 2));
            if (isNaN(dayNo) || dayNo < 0 || dayNo > 30) throw `Invalid date word provided: '${word}'`;
            const date = new Date(Date.now() - dayNo * 86400000);
            const iso = this.getIsoDate(date);
            if (!iso) throw `Invalid date word provided: '${word}'`;
            return iso;
        } catch (e) {
            this.log.error(this.err2Str(e));
            return false;
        }
    }

    /**
     * Get '00-today', '01-yesterday', '02-days-ago' etc. for a given ISO date '2023-12-24'
     */
    private getWordForIsoDate(isoDate: string): string | false {
        try {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
                throw `ISO date '${isoDate}' is not valid!`;
            }
            const date = new Date(isoDate);
            date.setHours(0, 0, 0, 0);
            const dateTs = date.getTime();
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const nowTs = now.getTime();
            const diffDays = Math.ceil((nowTs - dateTs) / 86400000);
            if (diffDays < 0) {
                throw `Negative date difference for given date, which is not supported.`;
            } else if (diffDays === 0) {
                return '00-today';
            } else if (diffDays === 1) {
                return '01-yesterday';
            } else {
                return String(diffDays).padStart(2, '0') + '-days-ago';
            }
        } catch (e) {
            this.log.error(this.err2Str(e));
            return false;
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            clearTimeout(this.timerMidnight);
            clearInterval(this.intervalCloudupdate);
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Oura(options);
} else {
    // otherwise start the instance directly
    (() => new Oura())();
}
