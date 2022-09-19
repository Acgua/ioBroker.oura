var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var main_exports = {};
__export(main_exports, {
  Oura: () => Oura
});
module.exports = __toCommonJS(main_exports);
var utils = __toESM(require("@iobroker/adapter-core"));
var import_axios = __toESM(require("axios"));
var import_methods = require("./lib/methods");
/**
 * -------------------------------------------------------------------
 *  ioBroker Oura Adapter
 * @github  https://github.com/Acgua/ioBroker.oura
 * @author  Acgua <https://github.com/Acgua/ioBroker.oura>
 * @created Adapter Creator v2.1.1
 * @license Apache License 2.0
 * -------------------------------------------------------------------
 */
class Oura extends utils.Adapter {
  constructor(options = {}) {
    super({ ...options, name: "oura" });
    this.err2Str = import_methods.err2Str.bind(this);
    this.isEmpty = import_methods.isEmpty.bind(this);
    this.wait = import_methods.wait.bind(this);
    this.getIsoDate = import_methods.getIsoDate.bind(this);
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.intervalCloudupdate = null;
  }
  async onReady() {
    try {
      let tkn = this.config.token;
      tkn = tkn.replace(/[^0-9A-Z]/g, "");
      if (tkn.length !== 32)
        throw `Your Oura cloud token in your adapter configuration is not valid! [${this.config.token}]`;
      this.config.token = tkn;
      if (!this.config.updateInterval || this.config.updateInterval < 15) {
        this.log.warn(`The Cloud update interval '${String(this.config.updateInterval)}' in your adapter configuration is not valid, so default of 60 minutes is used.`);
        this.config.updateInterval = 60;
      }
      if (!this.config.cloudTimeout || this.config.cloudTimeout < 0 || this.config.cloudTimeout > 1e5) {
        this.log.warn(`The Cloud timeout '${String(this.config.cloudTimeout)}' in your adapter configuration is not valid, so default of 5000 ms is used.`);
        this.config.cloudTimeout = 5e3;
      }
      await this.setObjectNotExistsAsync("info", { type: "channel", common: { name: "Information" }, native: {} });
      await this.setObjectNotExistsAsync("info.lastCloudUpdate", { type: "state", common: { name: "Last Cloud update", type: "number", role: "date", read: true, write: false, def: 0 }, native: {} });
      await this.asyncUpdateAll();
      this.intervalCloudupdate = setInterval(async () => {
        this.log.info(`Scheduled update of cloud information per interval of ${this.config.updateInterval} minutes.`);
        await this.asyncUpdateAll();
      }, 1e3 * 60 * this.config.updateInterval);
    } catch (e) {
      this.log.error(this.err2Str(e));
    }
  }
  async asyncUpdateAll() {
    try {
      await this.setStateAsync("info.lastCloudUpdate", { val: Date.now(), ack: true });
      const ouraTypes = ["daily_activity", "daily_readiness", "daily_sleep", "heartrate", "session", "sleep", "tag", "workout"];
      const startDate = new Date(Date.now() - 10 * 864e5);
      const endDate = new Date(Date.now() + 864e5);
      const gotData = [];
      const noData = [];
      for (const what of ouraTypes) {
        const cloudAllDays = await this.asyncGetCloudData(what, startDate, endDate);
        if (!cloudAllDays) {
          noData.push(what);
          continue;
        }
        gotData.push(what);
        await this.setObjectNotExistsAsync(what, { type: "device", common: { name: what }, native: {} });
        for (const cloudDay of cloudAllDays) {
          let day;
          if (cloudDay.timestamp) {
            day = new Date(cloudDay.timestamp);
          } else if (cloudDay.day && typeof cloudDay.day === "string") {
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
          await this.setObjectNotExistsAsync(`${what}.${dayPart}`, { type: "channel", common: { name: dayPart + " - " + what }, native: {} });
          await this.setObjectNotExistsAsync(`${what}.${dayPart}.json`, { type: "state", common: { name: "JSON", type: "string", role: "json", read: true, write: false }, native: {} });
          await this.setStateChangedAsync(`${what}.${dayPart}.json`, { val: JSON.stringify(cloudDay), ack: true });
          for (const prop in cloudDay) {
            if (prop === "timestamp") {
              await this.setObjectNotExistsAsync(`${what}.${dayPart}.timestamp`, { type: "state", common: { name: "Timestamp", type: "number", role: "date", read: true, write: false }, native: {} });
              await this.setStateChangedAsync(`${what}.${dayPart}.timestamp`, { val: new Date(cloudDay.timestamp).getTime(), ack: true });
            } else if (prop === "contributors") {
              for (const k in cloudDay.contributors) {
                await this.setObjectNotExistsAsync(`${what}.${dayPart}.contributors.${k}`, { type: "state", common: { name: k, type: "number", role: "info", read: true, write: false }, native: {} });
                await this.setStateChangedAsync(`${what}.${dayPart}.contributors.${k}`, { val: cloudDay.contributors[k], ack: true });
              }
            } else if (typeof cloudDay[prop] === "number") {
              await this.setObjectNotExistsAsync(`${what}.${dayPart}.${prop}`, { type: "state", common: { name: prop, type: "number", role: "info", read: true, write: false }, native: {} });
              await this.setStateChangedAsync(`${what}.${dayPart}.${prop}`, { val: cloudDay[prop], ack: true });
            } else if (typeof cloudDay[prop] === "string") {
              await this.setObjectNotExistsAsync(`${what}.${dayPart}.${prop}`, { type: "state", common: { name: prop, type: "string", role: "info", read: true, write: false }, native: {} });
              await this.setStateChangedAsync(`${what}.${dayPart}.${prop}`, { val: cloudDay[prop], ack: true });
            } else if (typeof cloudDay[prop] === "boolean") {
              await this.setObjectNotExistsAsync(`${what}.${dayPart}.${prop}`, { type: "state", common: { name: prop, type: "boolean", role: "info", read: true, write: false }, native: {} });
              await this.setStateChangedAsync(`${what}.${dayPart}.${prop}`, { val: cloudDay[prop], ack: true });
            } else if (typeof cloudDay[prop] === "object") {
            } else {
              this.log.error(`${what}: property '${prop}' is unknown! - value: [${cloudDay[prop]}], type: ${typeof cloudDay[prop]}`);
            }
          }
        }
      }
      if (gotData.length > 0)
        this.log.info(`Following data received from Oura cloud: ${gotData.join(", ")}`);
      if (noData.length > 0)
        this.log.debug(`No Oura cloud data available for: ${noData.join(", ")}`);
    } catch (e) {
      this.log.error(this.err2Str(e));
    }
  }
  async asyncGetCloudData(what, startDate, endDate) {
    var _a, _b, _c, _d, _e, _f;
    try {
      const sDate = this.getIsoDate(startDate);
      const eDate = this.getIsoDate(endDate);
      if (!sDate || !eDate)
        throw `Could not get cloud data, wrong date(s) provided`;
      const url = `https://api.ouraring.com/v2/usercollection/${what}?start_date=${sDate}&end_date=${eDate}`;
      this.log.debug("Final URL: " + url);
      try {
        const config = {
          method: "get",
          headers: { Authorization: "Bearer " + this.config.token },
          timeout: this.config.cloudTimeout
        };
        const response = await import_axios.default.get(url, config);
        this.log.debug(`Response Status: ${response.status} - ${response.statusText}`);
        this.log.debug(`Response Config: ${JSON.stringify(response.config)}`);
        if (!response.data || !response.data.data || !response.data.data[0]) {
          return false;
        }
        return response.data.data;
      } catch (err) {
        if (import_axios.default.isAxiosError(err)) {
          if (!(err == null ? void 0 : err.response)) {
            this.log.error(`[Oura Cloud] Login Failed - No Server Response. Timeout: ${this.config.cloudTimeout} ms`);
          } else if (((_a = err.response) == null ? void 0 : _a.status) === 400) {
            this.log.error("[Oura Cloud] Login Failed - Error 400 - " + ((_b = err.response) == null ? void 0 : _b.statusText));
          } else if (((_c = err.response) == null ? void 0 : _c.status) === 401) {
            this.log.error(`[Oura Cloud] Error 401 - Invalid Access Token. Access token not provided or is invalid.`);
            this.log.error(`[Oura Cloud] Login Failed. Please check if your token "${this.config.token}" is correct.`);
          } else if (((_d = err.response) == null ? void 0 : _d.status) === 426) {
            this.log.error(`[Oura Cloud] Error 426 - Minimum App Version Error. The Oura user's mobile app does not meet the minimum app version requirement to support sharing the requested data type. The Oura user must update their mobile app to enable API access for the requested data type.`);
            this.log.error(`[Oura Cloud] Login Failed. Please ensure you use the latest Oura app`);
          } else if (((_e = err.response) == null ? void 0 : _e.status) === 429) {
            this.log.error(`[Oura Cloud] Error 429 - Request Rate Limit Exceeded. The API is rate limited to 5000 requests in a 5 minute period and you exceed this limit.`);
            this.log.error(`[Oura Cloud] Login Failed.`);
          } else if ((_f = err.response) == null ? void 0 : _f.status) {
            console.log(`[Oura Cloud] Login Failed: Error ${err.response.status} - ${err.response.statusText}`);
          } else {
            console.log("[Oura Cloud] Login Failed - Error");
          }
        } else {
          if (err instanceof Error) {
            if (err.stack) {
              if (err.stack.startsWith("TypeError")) {
                this.log.error("[Oura Cloud] TYPE ERROR:" + err.stack);
              } else {
                this.log.error("[Oura Cloud] OTHER ERROR: " + err.stack);
              }
            }
            if (err.message)
              this.log.error("msg: " + err.message);
          } else {
            this.log.error("[Oura Cloud] Error: " + this.err2Str(err));
          }
        }
        return false;
      }
    } catch (e) {
      this.log.error(this.err2Str(e));
      return false;
    }
  }
  getWordForIsoDate(date) {
    try {
      const dateTs = date.getTime();
      date.setHours(0, 0, 0, 0);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const nowTs = now.getTime();
      const diffDays = Math.ceil((nowTs - dateTs) / 864e5);
      if (diffDays < 0) {
        throw `Negative date difference for given date, which is not supported.`;
      } else if (diffDays === 0) {
        return "00-today";
      } else if (diffDays === 1) {
        return "01-yesterday";
      } else {
        return String(diffDays).padStart(2, "0") + "-days-ago";
      }
    } catch (e) {
      this.log.error(this.err2Str(e));
      return false;
    }
  }
  onUnload(callback) {
    try {
      clearInterval(this.intervalCloudupdate);
      callback();
    } catch (e) {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Oura(options);
} else {
  (() => new Oura())();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Oura
});
//# sourceMappingURL=main.js.map
