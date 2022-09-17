/**
 * Methods and Tools
 * @desc    Methods and Tools
 * @author  Acgua <https://github.com/Acgua/ioBroker.oura>
 * @license Apache License 2.0
 *
 * ----------------------------------------------------------------------------------------
 * How to implement this file in main.ts (see also https://stackoverflow.com/a/58459668)
 * ----------------------------------------------------------------------------------------
 *  1. Add "this: Oura" as first function parameter if you need access to "this"
 *       -> no need to provide this parameter when calling the method, though!
 *  1. Add line like "import { err2Str, isEmpty } from './lib/methods';"
 *  2. Add keyword "export" before "class Oura extends utils.Adapter"
 *  3. class Oura: for each method, add line like: "public isEmpty = isEmpty.bind(this);"
 *           Note: use "private isEmpty..." and not "public", if you do not need to access method from this file
 */

import { Oura } from '../main';

/**
 * Convert error to string
 * @param {*} error - any kind of thrown error
 * @returns string
 */
export function err2Str(error: any): string {
    if (error instanceof Error) {
        if (error.stack) return error.stack;
        if (error.message) return error.message;
        return JSON.stringify(error);
    } else {
        if (typeof error === 'string') return error;
        return JSON.stringify(error);
    }
}

/**
 * Checks if an operand (variable, constant, object, ...) is considered as empty.
 * - empty:     undefined; null; string|array|object, stringified and only with white space(s), and/or `><[]{}`
 * - NOT empty: not matching anything above; any function; boolean false; number -1
 * inspired by helper.js from SmartControl adapter
 */
export function isEmpty(toCheck: any): true | false {
    if (toCheck === null || typeof toCheck === 'undefined') return true;
    if (typeof toCheck === 'function') return false;
    let x = JSON.stringify(toCheck);
    x = x.replace(/\s+/g, ''); // white space(s)
    x = x.replace(/"+/g, ''); // "
    x = x.replace(/'+/g, ''); // '
    x = x.replace(/\[+/g, ''); // [
    x = x.replace(/\]+/g, ''); // ]
    x = x.replace(/\{+/g, ''); // {
    x = x.replace(/\}+/g, ''); // }
    return x === '' ? true : false;
}

/**
 * async wait/pause
 * Actually not needed since a single line, but for the sake of using wait more easily
 * @param {number} ms - number of milliseconds to wait
 */
export async function wait(this: Oura, ms: number): Promise<void> {
    try {
        await new Promise((w) => setTimeout(w, ms));
    } catch (e) {
        this.log.error(this.err2Str(e));
        return;
    }
}

/**
 * Convert date object or timestamp to ISO 8601 formated date "YYYY-MM-DD"
 * @param date - Date object or timestamp
 * @returns string - ISO 8601 formatted date like '2023-12-24' or false if error
 */
export function getIsoDate(this: Oura, date: number | Date): string | false {
    try {
        let d: Date;
        if (date instanceof Date && date.getMonth()) {
            d = date;
        } else if (typeof date === 'number' && date.toString().length > 12) {
            d = new Date(date);
        } else {
            throw 'Invalid date object or timestamp provided';
        }
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${month}-${day}`;
    } catch (e) {
        this.log.error('Invalid date object or timestamp provided');
        return false;
    }
}
