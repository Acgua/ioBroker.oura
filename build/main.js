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
      await this.asyncUpdateAll();
      this.intervalCloudupdate = setInterval(async () => {
        this.log.info("Scheduled update of cloud information.");
        await this.asyncUpdateAll();
      }, 1e3 * 60 * 60);
    } catch (e) {
      this.log.error(this.err2Str(e));
    }
  }
  async asyncUpdateAll() {
    try {
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
          if (!cloudDay.timestamp) {
            this.log.warn(`'${what}' Cloud data retrieval: No timestamp in object`);
            continue;
          }
          const isoToday = this.getIsoDate(new Date(cloudDay.timestamp));
          if (!isoToday) {
            this.log.warn(`'${what}' Cloud data retrieval: No valid timestamp: [${cloudDay.timestamp}]`);
            continue;
          }
          await this.setObjectNotExistsAsync(`${what}.${isoToday}`, { type: "channel", common: { name: isoToday + " - " + what }, native: {} });
          await this.setObjectNotExistsAsync(`${what}.${isoToday}.json`, { type: "state", common: { name: "JSON", type: "string", role: "json", read: true, write: false }, native: {} });
          await this.setStateAsync(`${what}.${isoToday}.json`, { val: JSON.stringify(cloudDay), ack: true });
          for (const prop in cloudDay) {
            if (prop === "timestamp") {
              await this.setObjectNotExistsAsync(`${what}.${isoToday}.timestamp`, { type: "state", common: { name: "Timestamp", type: "number", role: "date", read: true, write: false }, native: {} });
              await this.setStateAsync(`${what}.${isoToday}.timestamp`, { val: new Date(cloudDay.timestamp).getTime(), ack: true });
            } else if (prop === "contributors") {
              for (const k in cloudDay.contributors) {
                await this.setObjectNotExistsAsync(`${what}.${isoToday}.contributors.${k}`, { type: "state", common: { name: k, type: "number", role: "info", read: true, write: false }, native: {} });
                await this.setStateAsync(`${what}.${isoToday}.contributors.${k}`, { val: cloudDay.contributors[k], ack: true });
              }
            } else if (typeof cloudDay[prop] === "number") {
              await this.setObjectNotExistsAsync(`${what}.${isoToday}.${prop}`, { type: "state", common: { name: prop, type: "number", role: "info", read: true, write: false }, native: {} });
              await this.setStateAsync(`${what}.${isoToday}.${prop}`, { val: cloudDay[prop], ack: true });
            } else if (typeof cloudDay[prop] === "string") {
              await this.setObjectNotExistsAsync(`${what}.${isoToday}.${prop}`, { type: "state", common: { name: prop, type: "string", role: "info", read: true, write: false }, native: {} });
              await this.setStateAsync(`${what}.${isoToday}.${prop}`, { val: cloudDay[prop], ack: true });
            } else {
              this.log.error(`${what}: property '${prop}' is unknown! - value: [${cloudDay[prop]}], type: [${typeof cloudDay[prop]}]`);
            }
          }
        }
      }
      if (gotData.length > 0)
        this.log.info(`Following data received from Oura cloud: ${gotData.join(", ")}`);
      if (noData.length > 0)
        this.log.warn(`Could not get following data from Oura cloud: ${noData.join(", ")}`);
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
      const timeout = 3e3;
      try {
        const config = {
          method: "get",
          headers: { Authorization: "Bearer " + this.config.token },
          timeout
        };
        const response = await import_axios.default.get(url, config);
        if (!response.data || !response.data.data || !response.data.data[0]) {
          return false;
        }
        return response.data.data;
      } catch (err) {
        if (import_axios.default.isAxiosError(err)) {
          if (!(err == null ? void 0 : err.response)) {
            this.log.error(`[Oura Cloud] Login Failed - No Server Response. Timeout: ${timeout} ms`);
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
