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
import { err2Str, getIsoDate, isEmpty, wait } from './lib/methods';

/**
 * Main Adapter Class
 */
export class Oura extends utils.Adapter {
    // Imported methods from ./lib/methods
    public err2Str = err2Str.bind(this);
    public isEmpty = isEmpty.bind(this);
    public wait = wait.bind(this);
    public getIsoDate = getIsoDate.bind(this);
    private intervalCloudupdate: any;

    /**
     * Constructor
     */
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'oura' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        // this.on('stateChange', this.onStateChange.bind(this));
        this.intervalCloudupdate = null;
    }

    /**
     * Called once ioBroker databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        try {
            // Basic verification of token
            let tkn = this.config.token;
            tkn = tkn.replace(/[^0-9A-Z]/g, ''); // remove all forbidden chars
            if (tkn.length !== 32) throw `Your Oura cloud token in your adapter configuration is not valid! [${this.config.token}]`;
            this.config.token = tkn;

            // Verify Oura Cloud update interval
            if (!this.config.updateInterval || this.config.updateInterval < 15) {
                this.log.warn(`The Cloud update interval '${String(this.config.updateInterval)}' in your adapter configuration is not valid, so default of 60 minutes is used.`);
                this.config.updateInterval = 60;
            }

            // Verify axios get request timeout
            if (!this.config.cloudTimeout || this.config.cloudTimeout < 0 || this.config.cloudTimeout > 100000) {
                this.log.warn(`The Cloud timeout '${String(this.config.cloudTimeout)}' in your adapter configuration is not valid, so default of 5000 ms is used.`);
                this.config.cloudTimeout = 5000;
            }

            // Create info objects
            await this.setObjectNotExistsAsync('info', { type: 'channel', common: { name: 'Information' }, native: {} });
            await this.setObjectNotExistsAsync('info.lastCloudUpdate', { type: 'state', common: { name: 'Last Cloud update', type: 'number', role: 'date', read: true, write: false, def: 0 }, native: {} });

            // Update now
            await this.asyncUpdateAll();

            // Update periodically
            this.intervalCloudupdate = setInterval(async () => {
                this.log.info(`Scheduled update of cloud information per interval of ${this.config.updateInterval} minutes.`);
                await this.asyncUpdateAll();
            }, 1000 * 60 * this.config.updateInterval); // typically every hour (this.config.updateInterval default is 60 minutes)
        } catch (e) {
            this.log.error(this.err2Str(e));
        }
    }

    /**
     * Update
     */
    private async asyncUpdateAll(): Promise<void> {
        try {
            await this.setStateAsync('info.lastCloudUpdate', { val: Date.now(), ack: true });
            const ouraTypes = ['daily_activity', 'daily_readiness', 'daily_sleep', 'heartrate', 'session', 'sleep', 'tag', 'workout'];
            const startDate = new Date(Date.now() - 10 * 86400000); // 86400000 = 24 hours in ms
            const endDate = new Date(Date.now() + 86400000); // for yet some unknown reason, some data require a "+1d"...
            const gotData = [];
            const noData = [];
            for (const what of ouraTypes) {
                const cloudAllDays = await this.asyncGetCloudData(what, startDate, endDate);
                if (!cloudAllDays) {
                    noData.push(what);
                    continue;
                }
                gotData.push(what);
                await this.setObjectNotExistsAsync(what, { type: 'device', common: { name: what }, native: {} });

                for (const cloudDay of cloudAllDays) {
                    let day;
                    // .sleep does not provide timestamp, but only .day in ISO format.
                    if (cloudDay.timestamp) {
                        day = new Date(cloudDay.timestamp);
                    } else if (cloudDay.day && typeof cloudDay.day === 'string') {
                        day = new Date(cloudDay.day);
                    } else {
                        this.log.warn(`'${what}' Cloud data retrieval: No date in object, so we disregard`);
                        continue;
                    }
                    const dayPart = this.getWordForIsoDate(day);
                    if (!dayPart) {
                        this.log.warn(`'${what}' Cloud data retrieval: No valid timestamp or other issue with timestamp: [${cloudDay.timestamp}]`);
                        continue;
                    }

                    await this.setObjectNotExistsAsync(`${what}.${dayPart}`, { type: 'channel', common: { name: dayPart + ' - ' + what }, native: {} });
                    await this.setObjectNotExistsAsync(`${what}.${dayPart}.json`, { type: 'state', common: { name: 'JSON', type: 'string', role: 'json', read: true, write: false }, native: {} });
                    await this.setStateChangedAsync(`${what}.${dayPart}.json`, { val: JSON.stringify(cloudDay), ack: true });
                    for (const prop in cloudDay) {
                        if (prop === 'timestamp') {
                            await this.setObjectNotExistsAsync(`${what}.${dayPart}.timestamp`, { type: 'state', common: { name: 'Timestamp', type: 'number', role: 'date', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${what}.${dayPart}.timestamp`, { val: new Date(cloudDay.timestamp).getTime(), ack: true });
                        } else if (prop === 'contributors') {
                            for (const k in cloudDay.contributors) {
                                await this.setObjectNotExistsAsync(`${what}.${dayPart}.contributors.${k}`, { type: 'state', common: { name: k, type: 'number', role: 'info', read: true, write: false }, native: {} });
                                await this.setStateChangedAsync(`${what}.${dayPart}.contributors.${k}`, { val: cloudDay.contributors[k], ack: true });
                            }
                        } else if (typeof cloudDay[prop] === 'number') {
                            await this.setObjectNotExistsAsync(`${what}.${dayPart}.${prop}`, { type: 'state', common: { name: prop, type: 'number', role: 'info', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${what}.${dayPart}.${prop}`, { val: cloudDay[prop], ack: true });
                        } else if (typeof cloudDay[prop] === 'string') {
                            await this.setObjectNotExistsAsync(`${what}.${dayPart}.${prop}`, { type: 'state', common: { name: prop, type: 'string', role: 'info', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${what}.${dayPart}.${prop}`, { val: cloudDay[prop], ack: true });
                        } else if (typeof cloudDay[prop] === 'boolean') {
                            await this.setObjectNotExistsAsync(`${what}.${dayPart}.${prop}`, { type: 'state', common: { name: prop, type: 'boolean', role: 'info', read: true, write: false }, native: {} });
                            await this.setStateChangedAsync(`${what}.${dayPart}.${prop}`, { val: cloudDay[prop], ack: true });
                        } else if (typeof cloudDay[prop] === 'object') {
                            // Nothing, we disregard objects, will be available in JSON anyway
                        } else {
                            this.log.error(`${what}: property '${prop}' is unknown! - value: [${cloudDay[prop]}], type: ${typeof cloudDay[prop]}`);
                        }
                    }
                }
            }
            if (gotData.length > 0) this.log.info(`Following data received from Oura cloud: ${gotData.join(', ')}`);
            if (noData.length > 0) this.log.debug(`No Oura cloud data available for: ${noData.join(', ')}`);
        } catch (e) {
            this.log.error(this.err2Str(e));
        }
    }

    /**
     * Get Oura Cloud Information
     * @param what - daily_activity, etc.
     * @param startDate as date object or timestamp
     * @param endDate as date object or timestamp
     * @returns Object
     */
    private async asyncGetCloudData(what: string, startDate: Date | number, endDate: Date | number): Promise<[{ [k: string]: any }] | false> {
        try {
            // Verify dates and convert to ISO format
            const sDate = this.getIsoDate(startDate);
            const eDate = this.getIsoDate(endDate);
            if (!sDate || !eDate) throw `Could not get cloud data, wrong date(s) provided`;
            const url = `https://api.ouraring.com/v2/usercollection/${what}?start_date=${sDate}&end_date=${eDate}`;
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
     * Get '00-today', '01-yesterday', '02-days-ago' etc. for a given Date object
     */
    private getWordForIsoDate(date: Date): string | false {
        try {
            const dateTs = date.getTime();
            date.setHours(0, 0, 0, 0);
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
